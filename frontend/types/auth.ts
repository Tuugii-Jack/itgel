export interface Me {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  address: {
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
  };
  notifications: { payment: boolean; arrival: boolean; promo: boolean };
  bank: {
    name: string;
    accountNumber: string;
    accountName: string;
    defaultPayout: boolean;
  };
  createdAt: string;
}

export interface AdminCustomer {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  address?: {
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
  };
  bank?: {
    name: string;
    accountNumber: string;
    accountName: string;
    defaultPayout: boolean;
  };
  notifications?: {
    payment: boolean;
    arrival: boolean;
    promo: boolean;
  };
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  createdAt: string;
}

export interface AdminCategory {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
  createdAt: string;
}

export interface AdminStaffUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "STAFF" | "LEASING" | "OWNER";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  hasLoginPhone?: boolean;
}
