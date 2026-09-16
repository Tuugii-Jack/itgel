import { useCallback, useEffect, useMemo, useState } from "react";
import { DELIVERY_STATUS_LABEL } from "@/components/admin/shared";
import { adminApi, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import { dayKey } from "@/lib/format";
import { placeZone } from "@/lib/locations";
import { groupDeliveriesByDistrict, printDeliveries, splitDeliveryZones } from "@/lib/printDeliveries";
import { useToast } from "@/lib/toast";
import type { AdminDelivery, DeliveryStatus } from "@/lib/types";

export type DeliveriesTab = "send" | "history";

export function useDeliveries(tab: DeliveriesTab) {
  const toast = useToast();

  const [selectedDays, setSelectedDays] = useState<string[]>(() => [dayKey(new Date())]);
  const [selectedDistricts, setSelectedDistricts] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [zoneFilter, setZoneFilter] = useState<"" | "city" | "aimag">("");
  const [rows, setRows] = useState<AdminDelivery[]>([]);
  const [couriers, setCouriers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const daysKey = selectedDays.slice().sort().join(",");

  const load = useCallback(async () => {
    if (selectedDays.length === 0) {
      setRows([]);
      setCouriers({});
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    setRefreshing(true);
    try {
      const list = await adminApi.deliveries({
        days: daysKey,
        status: status || undefined,
        pageSize: 500,
      });
      setRows(list);
      setCouriers(Object.fromEntries(list.map((d) => [d.id, d.courierName ?? ""])));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [daysKey, selectedDays.length, status, toast]);

  useEffect(() => {
    if (tab !== "send") return;
    return deferEffect(() => { void load(); });
  }, [load, tab]);

  const workRows = useMemo(
    () => (status === "DELIVERED" ? rows : rows.filter((r) => r.status !== "DELIVERED")),
    [rows, status],
  );

  const visibleRows = useMemo(() => {
    const zoned = zoneFilter ? workRows.filter((r) => placeZone(r.district) === zoneFilter) : workRows;
    if (selectedDistricts.size === 0) return zoned;
    return zoned.filter((r) => selectedDistricts.has(r.district));
  }, [workRows, zoneFilter, selectedDistricts]);

  const groups = useMemo(() => groupDeliveriesByDistrict(visibleRows), [visibleRows]);
  const zones = useMemo(() => splitDeliveryZones(groups), [groups]);
  const allGroups = useMemo(() => groupDeliveriesByDistrict(workRows), [workRows]);
  const allZones = useMemo(() => splitDeliveryZones(allGroups), [allGroups]);

  const pending = workRows.length;
  const cityCount = workRows.filter((r) => placeZone(r.district) === "city").length;
  const aimagCount = workRows.filter((r) => placeZone(r.district) === "aimag").length;

  const toggleDay = (date: string, byDate: { has(date: string): boolean }) => {
    if (!byDate.has(date) && !selectedDays.includes(date)) return;
    setSelectedDays((prev) => {
      const next = prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date].sort();
      return next;
    });
    setSelectedDistricts(new Set());
  };

  const toggleDistrict = (district: string) => {
    setSelectedDistricts((prev) => {
      const next = new Set(prev);
      if (next.has(district)) next.delete(district);
      else next.add(district);
      return next;
    });
  };

  const save = async (id: string, patch: { courierName?: string | null; status?: string }) => {
    setBusy(id);
    setError(null);
    try {
      await adminApi.updateDelivery(id, patch);
      setRows((prev) =>
        prev.map((r) =>
          r.id !== id
            ? r
            : {
                ...r,
                courierName: patch.courierName !== undefined ? patch.courierName : r.courierName,
                status: (patch.status as DeliveryStatus | undefined) ?? r.status,
              },
        ),
      );
      toast.success(
        patch.status
          ? `Төлөв «${DELIVERY_STATUS_LABEL[patch.status as DeliveryStatus]}» боллоо.`
          : "Хүргэлт хадгалагдлаа.",
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const onCourier = (id: string, v: string) => setCouriers((prev) => ({ ...prev, [id]: v }));

  const printOpts = { days: selectedDays };
  const printSelection = () => {
    if (visibleRows.length === 0) {
      toast.error("Хэвлэх хүргэлт алга.");
      return;
    }
    printDeliveries(visibleRows, printOpts);
  };

  return {
    selectedDays,
    setSelectedDays,
    selectedDistricts,
    setSelectedDistricts,
    status,
    setStatus,
    zoneFilter,
    setZoneFilter,
    rows,
    couriers,
    loading,
    refreshing,
    busy,
    error,
    load,
    visibleRows,
    zones,
    allGroups,
    allZones,
    pending,
    cityCount,
    aimagCount,
    toggleDay,
    toggleDistrict,
    save,
    onCourier,
    printOpts,
    printSelection,
  };
}
