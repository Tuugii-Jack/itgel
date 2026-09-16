/**
 * HTML хэвлэх.
 *
 * Brave: `about:blank` + document.write / 0×0 iframe ихэвчлэн цагаан хоосон гарна.
 * Blob URL + шинэ цонх (noopener биш) ашиглана. Popup хаагдвал iframe.
 */
export function printHtml(
  html: string,
  size?: { width?: number; height?: number },
): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const width = size?.width ?? 420;
  const height = size?.height ?? 720;

  // noopener хэрэглэхгүй — reference null болж хоосон цагаан таб үлдэнэ.
  const w = window.open(url, "_blank", `width=${width},height=${height}`);
  if (!w) {
    printViaIframe(url);
    return;
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      w.close();
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(url);
  };

  const trigger = () => {
    if (done) return;
    try {
      w.focus();
      w.print();
    } catch {
      finish();
      printViaIframe(URL.createObjectURL(blob));
      return;
    }
    w.addEventListener("afterprint", finish, { once: true });
    // afterprint өгөхгүй браузерт нөөц хаалт.
    window.setTimeout(finish, 60_000);
  };

  w.addEventListener("load", () => window.setTimeout(trigger, 120), { once: true });
  // Brave заримдаа load event өгөхгүй.
  window.setTimeout(() => {
    try {
      if (!done && w.document.readyState === "complete") trigger();
    } catch {
      /* ignore */
    }
  }, 600);
}

function printViaIframe(url: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // 0×0 биш — Brave/Chromium хоосон хэвлэлт гаргадаг.
  iframe.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0.01;z-index:-1";
  document.body.appendChild(iframe);
  iframe.src = url;

  const cleanup = () => {
    iframe.remove();
    URL.revokeObjectURL(url);
  };

  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        window.setTimeout(cleanup, 2000);
      }
    }, 150);
  };
}
