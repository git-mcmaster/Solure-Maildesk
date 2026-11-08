import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Bootstrap,
  LoadEvent,
  LoadEventPage,
  Notification,
  Pixel,
  PixelReport,
  PixelStatus,
  ReportPage,
  RequestMetadata,
  Settings,
} from "../server/types";
import { emailContent, imageAddresses, optOutContent, type EmailImageFormat } from "./signature";
import OutreachQueue from "./OutreachQueue";
import UnsubscribeSetup from "./UnsubscribeSetup";
import { scheduleIso } from "./outreach-import";

type IconName =
  | "grid"
  | "activity"
  | "bell"
  | "settings"
  | "plus"
  | "arrow"
  | "search"
  | "copy"
  | "close"
  | "check"
  | "shield"
  | "download"
  | "pause"
  | "archive"
  | "trash"
  | "mail"
  | "report"
  | "refresh";
type PixelPage = { items: Pixel[]; total: number; hasMore: boolean };
type ContactPreference = { recipient: string; createdAt: string; source: "recipient" | "owner" };
type ContactPreferencePage = { items: ContactPreference[]; total: number; offset: number; hasMore: boolean };
const paths: Record<IconName, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5",
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  close: "M6 6l12 12 M18 6 6 18",
  check: "M4 12l5 5L20 6",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  pause: "M8 4v16 M16 4v16",
  archive: "M3 3h18v5H3z M5 8v13h14V8 M9 12h6",
  trash: "M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  mail: "M3 5h18v14H3z M3 5l9 8 9-8",
  report: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  refresh: "M20 8A8 8 0 1 0 20 16 M20 3v5h-5",
};
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "We couldn’t connect. Check your connection and try again.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok)
    throw new ApiError(
      body?.error?.message ||
        (response.status === 401
          ? "Your session needs a fresh sign-in. Reload to continue."
          : "The request could not be completed. Please try again."),
      response.status,
    );
  if (!body || !("data" in body))
    throw new Error(
      "The server returned an unexpected response. Please reload.",
    );
  return body.data as T;
}
const statusNames: Record<PixelStatus, string> = {
  draft: "Inactive",
  armed: "Active",
  paused: "Inactive",
  archived: "Archived",
};
function pixelStatusLabel(pixel: Pixel): string {
  if (pixel.outreachId && pixel.doNotContact) return "Do not contact";
  if (pixel.status === "armed" && pixel.armedAt && new Date(pixel.armedAt).getTime() > Date.now()) return "Scheduled";
  if (pixel.outreachId && pixel.status !== "armed") return "Review queue";
  return statusNames[pixel.status];
}
function plannedInputTime(value: string | null = null): string {
  const date = value ? new Date(value) : new Date(Date.now() + 5 * 60_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
const deliveryNames: Record<string, string> = {
  none: "No alert yet",
  pending: "Queued",
  sending: "Sending",
  sent: "Accepted by email service",
  failed: "Needs attention",
  dry_run: "Local test only",
  disabled: "Email alerts off",
};
const reportStatusNames: Record<PixelReport["status"], string> = {
  pending: "Queued for email",
  sending: "Sending",
  sent: "Accepted by email service",
  failed: "Delivery needs attention",
  dry_run: "Local test only",
};
function reportDueAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + 89 * 86_400_000).toISOString();
}
function formatDate(value: string | null, exact = false): string {
  if (!value) return "No loads recorded";
  const d = new Date(value);
  return exact
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
function requestLocation(metadata: RequestMetadata): string {
  return [metadata.city, metadata.region, metadata.country]
    .filter(Boolean)
    .join(", ") || "Location unavailable";
}

function RequestDetails({ metadata }: { metadata: RequestMetadata | null }) {
  const location = metadata
    ? requestLocation(metadata)
    : "";
  const rows: [string, string | null | undefined][] = metadata
    ? [
        ["Request IP", metadata.requestIp],
        ["Approximate request location", location],
        ["Request time zone", metadata.timezone],
        ["Network", metadata.network],
        ["Network number (ASN)", metadata.asn == null ? null : `AS${metadata.asn}`],
        ["Reported client", metadata.client],
        ["Reported platform", metadata.platform],
        ["Reported device", metadata.device],
        ["Possible proxy", metadata.proxy],
        ["Reported User-Agent", metadata.userAgent],
      ]
    : [];

  return (
    <details className="request-details">
      <summary>Request details</summary>
      {metadata ? (
        <div className="request-details-body">
          <p className="request-details-note">
            These describe the image request, not necessarily the reader. A
            proxy or privacy service may supply its own location and device
            information. No GPS location is collected.
          </p>
          <dl className="request-details-list">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "Unknown"}</dd>
              </div>
            ))}
          </dl>
          <p className="request-details-note">
            Client and device hints come from the reported User-Agent and can
            be inaccurate. An unknown proxy value does not rule out a proxy.
          </p>
        </div>
      ) : (
        <p className="request-details-note request-details-empty">
          No request details were saved for this load. Collection may have been
          off, or this load may predate the feature. Details can’t be recovered
          for earlier loads.
        </p>
      )}
    </details>
  );
}

function ReportCard({
  report, expanded = false, busy, offline, onRetry, onView, onDelete,
}: {
  report: PixelReport;
  expanded?: boolean;
  busy: string;
  offline: boolean;
  onRetry: (id: string) => void;
  onView: (pixelId: string) => void;
  onDelete: (report: PixelReport) => void;
}) {
  return (
    <details className="report-card" open={expanded ? true : undefined}>
      <summary>
        <span className="report-title">
          <strong>{report.label || "Untitled message"}</strong>
          <span>{report.recipient || "No recipient label"}</span>
        </span>
        <span className="report-status" data-status={report.status}>
          {reportStatusNames[report.status]}
        </span>
      </summary>
      <div className="report-card-body">
        <dl className="report-facts">
          <div><dt>Pixel created</dt><dd><time dateTime={report.pixelCreatedAt}>{formatDate(report.pixelCreatedAt, true)}</time></dd></div>
          <div><dt>Report due after 89 days</dt><dd><time dateTime={report.dueAt}>{formatDate(report.dueAt, true)}</time></dd></div>
          <div><dt>Snapshot recorded</dt><dd><time dateTime={report.createdAt}>{formatDate(report.createdAt, true)}</time></dd></div>
          <div><dt>Email attempts</dt><dd>{report.attempts}</dd></div>
          {report.deliveredAt && (report.status === "sent" || report.status === "dry_run") && (
            <div>
              <dt>{report.status === "sent" ? "Email service accepted" : "Local test recorded"}</dt>
              <dd><time dateTime={report.deliveredAt}>{formatDate(report.deliveredAt, true)}</time></dd>
            </div>
          )}
        </dl>
        {report.lastError && <p className="field-error">{report.lastError}</p>}
        {report.status === "sent" && <p className="quiet-note">Email-service acceptance does not confirm inbox delivery.</p>}
        {report.status === "dry_run" && <p className="quiet-note">This report was tested locally. No email was sent.</p>}
        <h3>Report snapshot</h3>
        <pre className="report-snapshot">{report.text}</pre>
        <div className="report-card-actions">
          {report.pixelId ? (
            <button className="text-button" disabled={!!busy || offline} onClick={() => onView(report.pixelId!)}>
              View private load history <Icon name="arrow" size={14} />
            </button>
          ) : <p className="quiet-note">The pixel is no longer available. This report snapshot is retained.</p>}
          {report.status === "failed" && (
            <button className="button secondary" disabled={!!busy || offline} onClick={() => onRetry(report.id)}>
              <Icon name="refresh" size={15} />{busy === `report-${report.id}` ? "Retrying…" : "Retry report email"}
            </button>
          )}
          {report.pixelId === null && (
            <button className="text-button danger-text" disabled={!!busy || offline} onClick={() => onDelete(report)}>
              <Icon name="trash" size={14} /> Delete saved report
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [workspaceView, setWorkspaceView] = useState<"messages" | "outreach">("messages");
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<Pixel | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [listItems, setListItems] = useState<Pixel[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const listRequestId = useRef(0);
  const [dialog, setDialog] = useState<
    "settings" | "notifications" | "reports" | "guide" | "contacts" | "delete" | "clear" | null
  >(null);
  const [draft, setDraft] = useState({ label: "", recipient: "", notes: "" });
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const settingsBaselineRef = useRef<Settings | null>(null);
  const [events, setEvents] = useState<LoadEvent[]>([]);
  const [eventsCursor, setEventsCursor] = useState<string | null>(null);
  const eventsExpandedRef = useRef(false);
  const eventsPendingRef = useRef(false);
  const eventsRequestId = useRef(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [pixelReport, setPixelReport] = useState<PixelReport | null>(null);
  const [pixelReportLoading, setPixelReportLoading] = useState(false);
  const [pixelReportError, setPixelReportError] = useState("");
  const pixelReportRequestId = useRef(0);
  const [reports, setReports] = useState<PixelReport[]>([]);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [reportsNextOffset, setReportsNextOffset] = useState(0);
  const [reportsHasMore, setReportsHasMore] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [focusedReport, setFocusedReport] = useState<PixelReport | null>(null);
  const [reportToDelete, setReportToDelete] = useState<PixelReport | null>(null);
  const reportsRefreshRef = useRef<HTMLButtonElement>(null);
  const reportsRequestId = useRef(0);
  const reportsExpandedRef = useRef(false);
  const reportsPendingRef = useRef(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [plannedSendTime, setPlannedSendTime] = useState(() => plannedInputTime());
  const [scheduleEmailAlerts, setScheduleEmailAlerts] = useState(false);
  useEffect(() => { setScheduleEmailAlerts(false); }, [data?.settings.emailEnabled]);
  const [emailFormat, setEmailFormat] = useState<EmailImageFormat>("signature");
  const [previewImages, setPreviewImages] = useState(true);
  const [includeOptOut, setIncludeOptOut] = useState(true);
  const [contactSearch, setContactSearch] = useState("");
  const [contactRecipient, setContactRecipient] = useState("");
  const [contacts, setContacts] = useState<ContactPreference[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const [contactsNextOffset, setContactsNextOffset] = useState(0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const contactsRequestId = useRef(0);
  const detailRef = useRef<HTMLElement>(null);
  const deepLinkOpened = useRef(false);
  const selected = selectedRecord;

  const load = useCallback(async () => {
    const next = await request<Bootstrap>("/api/bootstrap");
    setData(next);
    setListItems((items) =>
      items.map(
        (item) => next.pixels.find((pixel) => pixel.id === item.id) || item,
      ),
    );
    setError("");
    const id = selectedIdRef.current;
    if (id) {
      try {
        const record = await request<Pixel>(`/api/pixels/${id}`);
        if (selectedIdRef.current === id) setSelectedRecord(record);
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.status === 404 &&
          selectedIdRef.current === id
        ) {
          setSelectedId(null);
          setSelectedRecord(null);
        }
      }
    }
    return next;
  }, []);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    if (!data || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    const id = new URLSearchParams(window.location.search).get("pixel");
    if (!id) return;
    if (!/^[a-f0-9-]{32,36}$/u.test(id)) {
      setError("That message link is not valid.");
      return;
    }
    void request<Pixel>(`/api/pixels/${encodeURIComponent(id)}`)
      .then((pixel) => choose(pixel))
      .catch((err: Error) => setError(err.message));
  }, [data]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const loadList = useCallback(
    async (offset = 0) => {
      const requestId = ++listRequestId.current;
      setListLoading(true);
      try {
        const page = await request<PixelPage>(
          `/api/pixels?${new URLSearchParams({ q: debouncedSearch, status: filter, offset: String(offset), limit: "100" })}`,
        );
        if (requestId !== listRequestId.current) return;
        setListItems((items) =>
          offset
            ? [
                ...items,
                ...page.items.filter(
                  (item) => !items.some((existing) => existing.id === item.id),
                ),
              ]
            : page.items,
        );
        setListTotal(page.total);
        setHasMore(page.hasMore);
        setListError("");
      } catch (err) {
        if (requestId === listRequestId.current)
          setListError((err as Error).message);
      } finally {
        if (requestId === listRequestId.current) setListLoading(false);
      }
    },
    [debouncedSearch, filter],
  );
  useEffect(() => {
    void loadList();
    return () => {
      listRequestId.current += 1;
    };
  }, [loadList]);
  useEffect(() => {
    let alive = true;
    void load()
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load().catch((err: Error) => {
          if (alive) setError(err.message);
        });
    }, 15_000);
    const updateOnline = () => setOffline(!navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const loadEvents = useCallback(
    async (quiet = false, cursor: string | null = null) => {
      if (!selectedId) return;
      // Keep an expanded history stable while the owner reads older requests.
      // Manual refresh starts again at the newest page.
      if (quiet && (eventsExpandedRef.current || eventsPendingRef.current)) return;
      const requestId = ++eventsRequestId.current;
      eventsPendingRef.current = true;
      eventsExpandedRef.current = Boolean(cursor);
      if (!quiet) setEventsLoading(true);
      try {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const next = await request<LoadEventPage>(
          `/api/pixels/${selectedId}/events?${query}`,
        );
        if (requestId === eventsRequestId.current) {
          setEvents((current) =>
            cursor
              ? [...current, ...next.items.filter((item) => !current.some((event) => event.id === item.id))]
              : next.items,
          );
          setEventsCursor(next.nextCursor);
          eventsExpandedRef.current = Boolean(cursor);
          setEventsError("");
        }
      } catch (err) {
        if (requestId === eventsRequestId.current)
          setEventsError((err as Error).message);
      } finally {
        if (requestId === eventsRequestId.current) {
          eventsPendingRef.current = false;
          setEventsLoading(false);
        }
      }
    },
    [selectedId],
  );
  useEffect(() => {
    setEvents([]);
    setEventsCursor(null);
    eventsExpandedRef.current = false;
    if (!selectedId) return;
    void loadEvents();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadEvents(true);
    }, 15_000);
    return () => {
      eventsRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [loadEvents, selectedId]);

  const loadPixelReport = useCallback(async (quiet = false) => {
    if (!selectedId) return;
    const requestId = ++pixelReportRequestId.current;
    if (!quiet) setPixelReportLoading(true);
    try {
      const next = await request<PixelReport | null>(`/api/pixels/${selectedId}/report`);
      if (requestId !== pixelReportRequestId.current) return;
      setPixelReport(next);
      setPixelReportError("");
      if (next) setFocusedReport((current) => current?.id === next.id ? next : current);
    } catch (err) {
      if (requestId === pixelReportRequestId.current) setPixelReportError((err as Error).message);
    } finally {
      if (requestId === pixelReportRequestId.current) setPixelReportLoading(false);
    }
  }, [selectedId]);
  useEffect(() => {
    setPixelReport(null);
    setPixelReportError("");
    if (!selectedId) return;
    void loadPixelReport();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void loadPixelReport(true);
    }, 15_000);
    return () => {
      pixelReportRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [loadPixelReport, selectedId]);

  const loadReports = useCallback(async (offset = 0, quiet = false) => {
    if (quiet && (reportsExpandedRef.current || reportsPendingRef.current)) return;
    const requestId = ++reportsRequestId.current;
    reportsPendingRef.current = true;
    if (!quiet) setReportsLoading(true);
    try {
      const page = await request<ReportPage>(`/api/reports?${new URLSearchParams({ limit: "100", offset: String(offset) })}`);
      if (requestId !== reportsRequestId.current) return;
      setReports((current) => offset
        ? [...current, ...page.items.filter((item) => !current.some((report) => report.id === item.id))]
        : page.items);
      setFocusedReport((current) => current ? page.items.find((item) => item.id === current.id) || current : null);
      setReportsTotal(page.total);
      setReportsNextOffset(page.offset + page.items.length);
      setReportsHasMore(page.hasMore);
      reportsExpandedRef.current = offset > 0;
      setReportsError("");
    } catch (err) {
      if (requestId === reportsRequestId.current) setReportsError((err as Error).message);
    } finally {
      if (requestId === reportsRequestId.current) {
        reportsPendingRef.current = false;
        setReportsLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    if (dialog !== "reports") return;
    reportsExpandedRef.current = false;
    void loadReports();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void loadReports(0, true);
    }, 15_000);
    return () => {
      reportsRequestId.current += 1;
      reportsPendingRef.current = false;
      window.clearInterval(timer);
    };
  }, [dialog, loadReports]);

  const loadContacts = useCallback(async (offset = 0) => {
    const requestId = ++contactsRequestId.current;
    setContactsLoading(true);
    try {
      const page = await request<ContactPreferencePage>(`/api/do-not-contact?${new URLSearchParams({ q: contactSearch, offset: String(offset), limit: "100" })}`);
      if (requestId !== contactsRequestId.current) return;
      setContacts((current) => offset ? [...current, ...page.items.filter((item) => !current.some((entry) => entry.recipient === item.recipient))] : page.items);
      setContactsTotal(page.total);
      setContactsHasMore(page.hasMore);
      setContactsNextOffset(page.offset + page.items.length);
      setContactsError("");
    } catch (err) {
      if (requestId === contactsRequestId.current) setContactsError((err as Error).message);
    } finally {
      if (requestId === contactsRequestId.current) setContactsLoading(false);
    }
  }, [contactSearch]);
  useEffect(() => {
    if (dialog !== "contacts") return;
    const timer = window.setTimeout(() => void loadContacts(), 250);
    return () => { window.clearTimeout(timer); contactsRequestId.current += 1; };
  }, [dialog, loadContacts]);

  async function action(key: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  function choose(pixel: Pixel) {
    setDraft({
      label: pixel.label,
      recipient: pixel.recipient,
      notes: pixel.notes,
    });
    setSelectedId(pixel.id);
    setSelectedRecord(pixel);
    setPixelReport(null);
    setPixelReportError("");
    setPixelReportLoading(true);
    selectedIdRef.current = pixel.id;
    setCopyNotice("");
    setPlannedSendTime(plannedInputTime(pixel.scheduledSendAt));
    setScheduleEmailAlerts(false);
    setIncludeOptOut(true);
  }
  async function createPixel() {
    await action("create", async () => {
      const pixel = await request<Pixel>("/api/pixels", {
        method: "POST",
        body: "{}",
      });
      await load();
      setFilter("active");
      setSearch("");
      await loadList();
      choose(pixel);
      setToast(
        "Pixel created inactive. Prepare your email with tracking off, then start immediately or schedule tracking around your Outlook send time.",
      );
      window.setTimeout(
        () =>
          detailRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        60,
      );
    });
  }
  async function updatePixel(status?: PixelStatus, enableEmailAlerts = false) {
    if (!selected) return;
    await action(status || "save", async () => {
      const pixel = await request<Pixel>(`/api/pixels/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(draft.label !== selected.label ? { label: draft.label } : {}),
          ...(draft.recipient !== selected.recipient ? { recipient: draft.recipient } : {}),
          ...(draft.notes !== selected.notes ? { notes: draft.notes } : {}),
          ...(status ? { status } : {}),
          ...(enableEmailAlerts ? { enableEmailAlerts: true } : {}),
        }),
      });
      setSelectedRecord(pixel);
      await load();
      await loadList();
      setDraft({
        label: pixel.label,
        recipient: pixel.recipient,
        notes: pixel.notes,
      });
      setToast(
        status === "armed"
          ? pixel.armedAt && new Date(pixel.armedAt).getTime() > Date.now()
            ? "Tracking remains scheduled. Email alerts will apply after its start time."
            : "Tracking is active and email alerts are on. The first new image load after this start can email you."
          : status === "paused"
            ? "Tracking stopped. New image loads won’t be saved or create load emails. Your history is kept."
            : status === "archived"
              ? "Message archived. Tracking is off and your history is kept."
              : "Message details saved.",
      );
    });
  }
  async function schedulePixelTracking(event: FormEvent) {
    event.preventDefault();
    if (!selected || selected.outreachId) return;
    await action("schedule-tracking", async () => {
      if (dirty) throw new Error("Save the message’s recipient and details before scheduling tracking.");
      const sendAt = scheduleIso(plannedSendTime);
      const pixel = await request<Pixel>(`/api/pixels/${selected.id}/schedule`, { method: "POST", body: JSON.stringify({ sendAt, ...(!data?.settings.emailEnabled && scheduleEmailAlerts ? { enableEmailAlerts: true } : {}) }) });
      setSelectedRecord(pixel);
      await load();
      await loadList();
      setToast(`Tracking starts ${formatDate(pixel.armedAt, true)}, 45 seconds after your planned send. Schedule the email separately in Outlook.`);
    });
  }
  async function createOptOutLink() {
    if (!selected || selected.doNotContact || draft.recipient !== selected.recipient) return;
    const id = selected.id;
    await action("opt-out", async () => {
      await request<{ url: string; recipient: string }>(`/api/pixels/${id}/opt-out-link`, { method: "POST", body: "{}" });
      const pixel = await request<Pixel>(`/api/pixels/${id}`);
      if (selectedIdRef.current === id) { setSelectedRecord(pixel); setIncludeOptOut(true); }
      setToast("Opt-out footer ready. Creating it does not stop outreach or start tracking.");
    });
  }
  async function copyOptOutFooter() {
    if (!selected?.optOutUrl || copyBlocked) return;
    const content = optOutContent(selected.optOutUrl, selected.pixelUrl);
    try {
      if ("ClipboardItem" in window && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([content.html], { type: "text/html" }), "text/plain": new Blob([content.plainText], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(content.plainText);
      setCopyNotice("Opt-out footer copied for the saved recipient. Tracking and contact preferences are unchanged.");
    } catch { setCopyNotice("Clipboard access is unavailable. Copy the footer link from the field below."); }
  }
  async function addDoNotContact(event: FormEvent) {
    event.preventDefault();
    await action("contact-add", async () => {
      setContactsError("");
      try {
        await request<ContactPreference>("/api/do-not-contact", { method: "POST", body: JSON.stringify({ recipient: contactRecipient }) });
        setContactRecipient("");
        await Promise.all([loadContacts(), load(), loadList()]);
        setToast("Address added to do not contact. Maildesk flags it; Outlook sends remain under your control.");
      } catch (err) { setContactsError((err as Error).message); }
    });
  }
  async function copyPixel(rich: boolean) {
    if (!selected || !data || copyBlocked) return;
    const { html, plainText } = emailContent(selected.pixelUrl, data.ownerEmail, emailFormat, includeOptOut ? selected.optOutUrl : null);
    const trackingNotice = selected.status === "armed"
      ? selected.armedAt && new Date(selected.armedAt).getTime() > Date.now()
        ? `Tracking is scheduled for ${formatDate(selected.armedAt, true)}. Earlier image requests are ignored. `
        : "Tracking is active. Composer previews or scanners may be the first recorded load. "
      : "Tracking stays off while you prepare. Start immediately or schedule it around your Outlook send time. ";
    try {
      if (rich && "ClipboardItem" in window && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
        setCopyNotice(
          trackingNotice + (emailFormat === "signature"
            ? "Signature copied with one message-specific logo image. If your app pastes only contact text, tracking was not inserted. Verify with a test email."
            : "Rich HTML copied. Outlook may still embed or remove the image—verify your insertion method with a test message."),
        );
      } else {
        await navigator.clipboard.writeText(html);
        setCopyNotice(
          trackingNotice + "HTML source copied. Pasting source into a normal email body will not insert a tracking image. Use a client that supports HTML insertion.",
        );
      }
    } catch {
      setCopyNotice(
        "Clipboard access is unavailable. Select and copy the HTML below. Use a client that supports inserting HTML; pasting it as text will not track loads.",
      );
    }
  }
  async function copyTextSignature() {
    if (!selected || !data || copyBlocked) return;
    try {
      await navigator.clipboard.writeText(emailContent(selected.pixelUrl, data.ownerEmail, "signature", includeOptOut ? selected.optOutUrl : null).plainText);
      setCopyNotice("Contact text copied. This version has no image and does not record loads.");
    } catch {
      setCopyNotice("Clipboard access is unavailable. You can select and copy the contact text in the preview.");
    }
  }
  async function preserveUnloadedPixel(preserveUnloaded: boolean) {
    if (!selected) return;
    const id = selected.id;
    await action("preserve", async () => {
      const pixel = await request<Pixel>(`/api/pixels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ preserveUnloaded }),
      });
      if (selectedIdRef.current === id) setSelectedRecord(pixel);
      await load();
      await loadList();
      setToast(preserveUnloaded
        ? "This pixel will be kept even if it never loads."
        : "This pixel now follows your never-loaded pixel preference.");
    });
  }
  async function markRead(ids?: string[]) {
    await action("read", async () => {
      await request("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify(ids ? { ids } : {}),
      });
      await load();
    });
  }
  function openSettings() {
    if (data) {
      settingsBaselineRef.current = { ...data.settings };
      setSettingsDraft({ ...data.settings });
      setDialog("settings");
    }
  }
  function openReports(report: PixelReport | null = null) {
    setFocusedReport(report);
    setDialog("reports");
  }
  async function retryReport(id: string) {
    await action(`report-${id}`, async () => {
      await request(`/api/reports/${id}/retry`, { method: "POST", body: "{}" });
      await Promise.all([loadReports(), loadPixelReport(true)]);
      setToast("Report retry requested. Email-service acceptance will appear here.");
    });
  }
  async function viewReportPixel(pixelId: string) {
    await action("report-view", async () => {
      choose(await request<Pixel>(`/api/pixels/${pixelId}`));
      setDialog(null);
      window.setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    });
  }
  const filtered = listItems;
  const selectedTrackingScheduled = !!selected && selected.status === "armed" && !!selected.armedAt && new Date(selected.armedAt).getTime() > Date.now();
  const dirty =
    !!selected &&
    (draft.label !== selected.label ||
      draft.recipient !== selected.recipient ||
      draft.notes !== selected.notes);
  const recipientUnsaved = !!selected && draft.recipient !== selected.recipient;
  const copyBlocked = !!selected?.doNotContact || recipientUnsaved;
  const validSavedRecipient = !!selected?.recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(selected.recipient);
  const unread = data?.stats.unread || 0;

  if (loading)
    return (
      <div className="startup">
        <div className="brand-mark">
          s<span>.</span>
        </div>
        <p>
          Opening your maildesk<span className="loading-dot">…</span>
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="startup">
        <div className="brand-mark">
          s<span>.</span>
        </div>
        <h1>Let’s reconnect.</h1>
        <p role="alert">{error || "Maildesk could not be loaded."}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          <Icon name="refresh" /> Reload Maildesk
        </button>
      </div>
    );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <a href="/" className="brand" aria-label="Solure Maildesk home">
          <div className="brand-mark">
            s<span>.</span>
          </div>
          <div>
            <strong>
              solure<span className="brand-dot">.</span>
            </strong>
            <span className="brand-caption">MAILDESK</span>
          </div>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          <button
            className={workspaceView === "messages" && filter !== "archived" ? "nav-link selected" : "nav-link"}
            onClick={() => {
              setWorkspaceView("messages");
              setFilter("active");
              setSearch("");
            }}
          >
            <Icon name="grid" /> Messages{" "}
            <span className="nav-count">{data.stats.total}</span>
          </button>
          <button className={workspaceView === "outreach" ? "nav-link selected" : "nav-link"} aria-current={workspaceView === "outreach" ? "page" : undefined} onClick={() => setWorkspaceView("outreach")}>
            <Icon name="mail" /> Review queue
          </button>
          <button
            className="nav-link"
            onClick={() => setDialog("notifications")}
          >
            <Icon name="bell" /> Notifications{" "}
            {unread > 0 && (
              <span className="nav-count unread-count">{unread}</span>
            )}
          </button>
          <button className="nav-link" onClick={() => setDialog("contacts")} aria-label="Do not contact" aria-haspopup="dialog">
            <Icon name="shield" /> Do not contact
          </button>
          <button className="nav-link" onClick={() => openReports()} aria-haspopup="dialog">
            <Icon name="report" /> Reports
          </button>
          <button
            className={workspaceView === "messages" && filter === "archived" ? "nav-link selected" : "nav-link"}
            onClick={() => { setWorkspaceView("messages"); setFilter("archived"); }}
          >
            <Icon name="archive" /> Archive
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-link" onClick={() => setDialog("guide")}>
            <Icon name="activity" /> How tracking works
          </button>
          <button className="nav-link" onClick={openSettings}>
            <Icon name="settings" /> Settings
          </button>
          <div className="owner">
            <span className="avatar">EM</span>
            <div>
              <strong>Elijah McMaster</strong>
              <span>Private workspace</span>
            </div>
            <Icon name="shield" size={16} />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Maildesk</strong>
          </div>
          <div className="topbar-actions">
            {data.development && (
              <span className="environment">Local development</span>
            )}
            <span className="private-indicator">
              <Icon name="shield" size={14} />{" "}
              {data.development ? "Local access" : "Owner access"}
            </span>
            <button
              className="icon-button notification-button"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              onClick={() => setDialog("notifications")}
            >
              <Icon name="bell" />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            <span className="avatar small">EM</span>
          </div>
        </header>
        <main id="main" className="main-content">
          <div hidden={workspaceView !== "outreach"}><OutreachQueue ownerEmail={data.ownerEmail} pixelBaseUrl={data.pixelBaseUrl} development={data.development} active={workspaceView === "outreach"} onPixelsChanged={load} /></div>
          {workspaceView !== "outreach" && <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">A LITTLE MORE CLARITY</div>
              <h1>Your messages, in view.</h1>
              <p>Keep track of image activity. Follow up with context.</p>
            </div>
            <button
              className="button primary new-pixel"
              onClick={() => void createPixel()}
              disabled={!!busy || offline}
            >
              <Icon name="plus" />
              {busy === "create" ? "Creating…" : "New pixel"}
            </button>
          </div>
          {offline && (
            <div className="banner warning" role="status">
              You’re offline. Saved activity is shown; reconnect to make
              changes.
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() =>
                  void action("reload", async () => {
                    await load();
                  })
                }
              >
                Try again
              </button>
            </div>
          )}
          <section className="stats-grid" aria-label="Message overview">
            <Stat
              label="Messages"
              value={data.stats.total}
              icon="mail"
              footnote="Created in your workspace"
            />
            <Stat
              label="Tracking active"
              value={data.stats.armed}
              icon="activity"
              footnote="Messages saving new image requests"
            />
            <Stat
              label="Images loaded"
              value={data.stats.loaded}
              icon="check"
              footnote="Messages with a recorded request"
            />
          </section>
          <div className="workspace-grid">
            <section className="messages-card" aria-label="Tracked messages">
              <div className="section-heading">
                <div>
                  <h2>Messages</h2>
                  <span>
                    {filter === "archived"
                      ? "Your archived messages"
                      : "One pixel. One message. Your context."}
                  </span>
                </div>
                <a
                  className="icon-button export-button"
                  href="/api/export.csv"
                  download
                  aria-label="Export messages as CSV"
                >
                  <Icon name="download" />
                </a>
              </div>
              <div className="list-toolbar">
                <div className="tabs" aria-label="Filter messages">
                  {[
                    ["active", "Current"],
                    ["armed", "Tracking on"],
                    ["inactive", "Tracking off"],
                    ["all", "All"],
                  ].map(([value, title]) => (
                    <button
                      key={value}
                      className={filter === value ? "tab active" : "tab"}
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Icon name="search" size={16} />
                  <input
                    aria-label="Search messages"
                    placeholder="Search messages"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              {listError && (
                <div className="banner error list-error" role="alert">
                  <span>{listError}</span>
                  <button
                    className="text-button"
                    onClick={() => void loadList()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {listLoading && filtered.length === 0 ? (
                <div className="list-loading" role="status">
                  Loading messages…
                </div>
              ) : filtered.length > 0 ? (
                <div className="message-list">
                  <div className="list-labels">
                    <span>MESSAGE / RECIPIENT</span>
                    <span>STATUS</span>
                    <span>LATEST ACTIVITY</span>
                  </div>
                  {filtered.map((pixel) => (
                    <button
                      className={
                        selectedId === pixel.id
                          ? "message-row is-selected"
                          : "message-row"
                      }
                      key={pixel.id}
                      onClick={() => choose(pixel)}
                      aria-pressed={selectedId === pixel.id}
                    >
                      <span className="message-description">
                        <span
                          className={
                            pixel.loadCount > 0
                              ? "message-symbol loaded"
                              : "message-symbol"
                          }
                        >
                          <Icon
                            name={pixel.loadCount > 0 ? "activity" : "mail"}
                          />
                        </span>
                        <span>
                          <strong>{pixel.label || "Untitled message"}</strong>
                          <small>
                            {pixel.recipient || "Add a recipient or a note"}
                          </small>
                          {pixel.doNotContact && <span className="contact-blocked-badge">Do not contact</span>}
                        </span>
                      </span>
                      <span className={`status status-${pixel.status}`}>
                        <span />
                        {pixelStatusLabel(pixel)}
                      </span>
                      <span
                        className="row-activity"
                        title={formatDate(pixel.lastLoadedAt, true)}
                      >
                        {pixel.lastLoadedAt
                          ? formatDate(pixel.lastLoadedAt)
                          : "No loads yet"}
                        <small>
                          {pixel.loadCount
                            ? `${pixel.loadCount} image request${pixel.loadCount === 1 ? "" : "s"}`
                            : "Waiting for activity"}
                        </small>
                      </span>
                      <Icon name="arrow" size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <span className="empty-orbit" />
                    <Icon name={search ? "search" : "mail"} size={33} />
                    <span className="illustration-spark">+</span>
                  </div>
                  <h3>
                    {search
                      ? "No matching messages."
                      : filter === "archived"
                        ? "Nothing archived yet."
                        : data.pixels.length === 0
                          ? "Your first message starts here."
                          : "Nothing here just yet."}
                  </h3>
                  <p>
                    {search
                      ? "Try another label, recipient or note."
                      : filter === "archived"
                        ? "Archived messages will be kept here for reference."
                        : "Create a pixel, add it to your email, then return to give it a name."}
                  </p>
                  {!search && filter !== "archived" && (
                    <button
                      className="button secondary"
                      disabled={!!busy || offline}
                      onClick={() => void createPixel()}
                    >
                      <Icon name="plus" /> Create a pixel
                    </button>
                  )}
                </div>
              )}
              {hasMore && (
                <div className="load-more">
                  <button
                    className="button secondary"
                    disabled={listLoading}
                    onClick={() => void loadList(listItems.length)}
                  >
                    {listLoading ? "Loading…" : "Load more messages"}
                  </button>
                </div>
              )}
              <div className="list-footer">
                <span>
                  {filtered.length} of {listTotal} message
                  {listTotal === 1 ? "" : "s"}
                </span>
                <span>
                  <span className="live-dot" /> Updates every 15 seconds
                </span>
              </div>
            </section>
            <aside
              className="detail-column"
              ref={detailRef}
              aria-label={selected ? "Selected message" : "Getting started"}
            >
              {selected ? (
                <section className="detail-card">
                  <div className="detail-header">
                    <div className="eyebrow">MESSAGE DETAILS</div>
                    <button
                      className="icon-button"
                      aria-label="Close message details"
                      onClick={() => {
                        setSelectedId(null);
                        setSelectedRecord(null);
                        selectedIdRef.current = null;
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <h2>{selected.label || "Untitled message"}</h2>
                  <div className={`status status-${selected.status}`}>
                    <span />
                    {pixelStatusLabel(selected)}
                  </div>
                  {selected.doNotContact && (
                    <div className="contact-blocked-warning" role="status">
                      <strong><Icon name="shield" size={17} /> Do not contact this address</strong>
                      <p>This recipient has opted out of sales emails. Further image capture and new tracking sessions are blocked, and saved history stays. Maildesk cannot prevent you sending manually in Outlook.</p>
                      <button className="text-button" onClick={() => setDialog("contacts")}>View do-not-contact list</button>
                    </div>
                  )}
                  {selected.outreachId ? <section className="tracking-control" aria-label="Scheduled tracking control">
                    <div className="tracking-control-heading"><Icon name="mail" size={18} /><strong>Managed in your review queue</strong></div>
                    <p>{selected.doNotContact ? "New image capture is blocked for this opted-out recipient. Existing saved history stays available." : selected.status === "armed" && selected.armedAt
                      ? new Date(selected.armedAt).getTime() > Date.now()
                        ? `Tracking is waiting until ${formatDate(selected.armedAt, true)}. Earlier image requests are ignored.`
                        : "This image’s approved tracking window has started. Review its schedule and notification status in the queue."
                      : "This image belongs to a prepared message. Its approved recipient and scheduled delay are protected from manual changes here."}</p>
                    <button className="button secondary full-width" onClick={() => setWorkspaceView("outreach")}>Open review queue</button>
                    <p className="tracking-control-note">Maildesk schedules tracking only. Send or schedule the actual email separately in Outlook.</p>
                  </section> : <section className="tracking-control" data-active={selected.status === "armed" && !selectedTrackingScheduled} aria-label="Tracking control">
                    <div className="tracking-control-heading">
                      <Icon name={selected.status === "armed" ? "activity" : "pause"} size={18} />
                      <strong>{selectedTrackingScheduled ? "Tracking is scheduled" : selected.status === "armed" ? "Tracking is on" : "Tracking is off"}</strong>
                    </div>
                    <p>
                      {selectedTrackingScheduled
                        ? `Tracking starts ${formatDate(selected.armedAt, true)}, 45 seconds after your planned Outlook send time. Earlier image requests are ignored.`
                        : selected.status === "armed"
                        ? data.settings.emailEnabled
                          ? "New image loads are saved. The first new load after each start can email you."
                          : "New image loads are saved, but image-load emails are paused for all messages."
                        : selected.status === "archived"
                          ? "This message is archived. Restore it as inactive to start tracking again."
                          : "Images display normally, but no new loads or request details are saved. No new load emails are created."}
                    </p>
                    {selected.status !== "archived" && (
                      <>
                        {!data.settings.emailEnabled && data.notificationConfigured && (
                          <p className="tracking-control-note">Starting also resumes email alerts for your other active messages. Their next new loads can email you too.</p>
                        )}
                        {(selected.status !== "armed" || !data.settings.emailEnabled) && (
                          <button
                            className="button primary full-width"
                            onClick={() => void updatePixel("armed", true)}
                            disabled={!!busy || offline || !data.notificationConfigured || selected.doNotContact}
                          >
                            <Icon name="activity" size={17} />
                            {busy === "armed" ? "Starting…" : selected.status === "armed" ? "Resume email alerts" : "Start tracking & email me"}
                          </button>
                        )}
                        {selected.status === "armed" && (
                          <button className={`button ${data.settings.emailEnabled ? "primary" : "secondary"} full-width`} onClick={() => void updatePixel("paused")} disabled={!!busy || offline}>
                            <Icon name="pause" size={17} /> {busy === "paused" ? "Stopping…" : selectedTrackingScheduled ? "Cancel tracking schedule" : "Stop tracking"}
                          </button>
                        )}
                        {!data.notificationConfigured && <p className="tracking-control-note">Email alerts need configuration. You can schedule tracking below without email alerts.</p>}
                        {selected.status === "armed" && !selectedTrackingScheduled && (
                          <p className="tracking-control-note">
                            {selected.notificationStatus === "none"
                              ? selected.activationAlertAt
                                ? "A load email was already recorded for this start; its notification details are no longer available."
                                : "Waiting for the first new load since this start."
                              : `Load email this start: ${deliveryNames[selected.notificationStatus] || selected.notificationStatus}.`}
                            {selected.armedAt ? ` Started ${formatDate(selected.armedAt)}.` : ""}
                            {data.settings.repeatAlerts ? " Repeat-load alerts are also on." : " Later loads stay in the history without another email until a new tracking session starts."}
                          </p>
                        )}
                      </>
                    )}
                    {selected.status !== "archived" && (selected.status !== "armed" || selectedTrackingScheduled) && <form className="tracking-schedule-form" onSubmit={(event) => void schedulePixelTracking(event)}>
                      <label>Outlook scheduled send time<input type="datetime-local" required value={plannedSendTime} disabled={!!busy || offline} onChange={(event) => setPlannedSendTime(event.target.value)} /></label>
                      <p className="tracking-control-note">{Intl.DateTimeFormat().resolvedOptions().timeZone} · tracking begins 45 seconds later. Set the email’s send time separately in Outlook.</p>
                      {data.settings.emailEnabled ? <p className="tracking-control-note">Image-load emails are on in Settings. This schedule uses that setting.</p> : <label className="tracking-schedule-alerts"><input type="checkbox" checked={scheduleEmailAlerts} disabled={!!busy || offline || !data.notificationConfigured} onChange={(event) => setScheduleEmailAlerts(event.target.checked)} /><span>Resume image-load emails in Settings. This turns email alerts on for all active pixels.</span></label>}
                      {!data.settings.emailEnabled && !scheduleEmailAlerts && <p className="tracking-control-note">Image-load emails are paused in Settings. Scheduled tracking can still save activity.</p>}
                      {!validSavedRecipient && <p className="tracking-control-note">Add and save a complete recipient before scheduling so the do-not-contact check can protect this message.</p>}
                      {dirty && <p className="tracking-control-note">Save your message details before scheduling tracking.</p>}
                      <button className="button secondary full-width" type="submit" disabled={!!busy || offline || dirty || !validSavedRecipient || selected.doNotContact}>{busy === "schedule-tracking" ? "Saving schedule…" : selectedTrackingScheduled ? "Change tracking schedule" : "Schedule tracking + 45 seconds"}</button>
                      <p className="tracking-control-note">Changing or cancelling this schedule does not change Outlook’s email. Update both places if the planned send time changes. The saved tracking time works even when this dashboard is closed.</p>
                    </form>}
                    {selected.status === "armed" && !selectedTrackingScheduled && <p className="tracking-control-note">Stop tracking before creating a new tracking schedule. Your saved history will stay.</p>}
                    <p className="tracking-control-note">Copying doesn’t start tracking. Start immediately or choose a tracking schedule; previews after tracking starts can still count.</p>
                  </section>}
                  {!selected.outreachId && <>
                  <div className="workflow-step">
                    <span className="step-number">1</span>
                    <div>
                      <h3>Add your signature or tracking image</h3>
                      <p>
                        Use a fresh message-specific image for each email.
                        Prepare and paste while tracking is off. Start tracking
                        immediately before you press Send.
                      </p>
                    </div>
                  </div>
                  <fieldset className="email-format">
                    <legend>Email format</legend>
                    <label>
                      <input
                        type="radio"
                        name="email-format"
                        checked={emailFormat === "signature"}
                        onChange={() => { setEmailFormat("signature"); setCopyNotice(""); }}
                      />
                      <span>Logo signature</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="email-format"
                        checked={emailFormat === "pixel"}
                        onChange={() => { setEmailFormat("pixel"); setCopyNotice(""); }}
                      />
                      <span>Invisible pixel</span>
                    </label>
                  </fieldset>
                  {emailFormat === "signature" ? (
                    <div className="signature-option">
                      <div className="signature-preview-heading">
                        <span>Signature preview</span>
                        <label>
                          <input type="checkbox" checked={!previewImages} onChange={(event) => setPreviewImages(!event.target.checked)} />
                          Images hidden
                        </label>
                      </div>
                      <div className="signature-preview" aria-label="Signature preview, not tracked">
                        <div className="signature-preview-identity">
                          {previewImages ? (
                            <img src={imageAddresses(selected.pixelUrl).preview} width={48} height={50} alt="Solure Digital Works logo" />
                          ) : (
                            <span className="signature-logo-hidden" role="img" aria-label="Solure Digital Works logo, image hidden">Logo<br />hidden</span>
                          )}
                          <div><strong>Elijah McMaster</strong><span>Solure Digital Works</span></div>
                        </div>
                        <div className="signature-preview-contact">
                          <a href={`mailto:${data.ownerEmail}`}>{data.ownerEmail}</a>
                          <a href="https://soluredigitalworks.com" target="_blank" rel="noreferrer">soluredigitalworks.com</a>
                        </div>
                      </div>
                      <p className="signature-note">
                        While tracking is on, the logo records image requests for this message. There’s
                        no extra hidden pixel. This preview is untracked—use the
                        copy button to get your message’s unique image.
                      </p>
                    </div>
                  ) : (
                    <p className="signature-note">
                      A transparent 1 × 1 image for an email that already has a
                      signature. Use this or the logo signature, not both.
                    </p>
                  )}
                  <section className="outreach-footer" aria-label="Outreach opt-out footer">
                    <h3>Outreach opt-out</h3>
                    {selected.doNotContact ? (
                      <p>This recipient is on your do-not-contact list. No new outreach footer can be created.</p>
                    ) : recipientUnsaved ? (
                      <p className="outreach-save-note">Save the changed recipient below before copying. Existing links still belong to their original recipient.</p>
                    ) : !validSavedRecipient ? (
                      <p>Add and save one recipient below to create their opt-out footer.</p>
                    ) : selected.optOutUrl ? (
                      <>
                        <p>For <strong>{selected.recipient}</strong></p>
                        <label className="outreach-include"><input type="checkbox" checked={includeOptOut} onChange={(event) => setIncludeOptOut(event.target.checked)} /> Include footer when copying</label>
                        <div className="outreach-footer-preview">To stop receiving sales emails from Solure, <span>Stop outreach emails</span> or reply “opt out”.</div>
                        <button className="text-button" onClick={() => void copyOptOutFooter()} disabled={!!busy || offline}><Icon name="copy" size={15} /> Copy footer only</button>
                        <details className="outreach-link-details"><summary>View recipient’s opt-out link</summary><input aria-label="Recipient’s outreach opt-out link" readOnly value={selected.optOutUrl} onFocus={(event) => event.target.select()} /></details>
                      </>
                    ) : (
                      <>
                        <p>Create a footer for <strong>{selected.recipient}</strong>. It works even when images are blocked.</p>
                        <button className="button secondary full-width" onClick={() => void createOptOutLink()} disabled={!!busy || offline}>{busy === "opt-out" ? "Creating footer…" : "Create opt-out footer"}</button>
                      </>
                    )}
                    <p className="outreach-footer-note">Visiting the link only opens a confirmation page. The recipient must press “Stop outreach emails” to opt out. Links stay bound to their original address, even if this record changes or is deleted.</p>
                  </section>
                  {selected.optOutUrl && !selected.outreachId && <UnsubscribeSetup binding={{ kind: "pixel", id: selected.id }} recipient={selected.recipient} optOutUrl={selected.optOutUrl} pixelBaseUrl={data.pixelBaseUrl} disabled={copyBlocked} />}
                  <div className="copy-actions">
                    <button
                      className="button secondary"
                      onClick={() => void copyPixel(true)}
                      disabled={copyBlocked}
                    >
                      <Icon name="copy" size={16} /> Copy for Outlook
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void copyPixel(false)}
                      disabled={copyBlocked}
                    >
                      Copy HTML
                    </button>
                    {emailFormat === "signature" && (
                      <button className="text-button" disabled={copyBlocked} onClick={() => void copyTextSignature()}>Copy text only</button>
                    )}
                  </div>
                  <details className="html-details">
                    <summary>{emailFormat === "signature" ? "View signature HTML" : "View image HTML"}</summary>
                    <textarea
                      readOnly
                      aria-label={emailFormat === "signature" ? "Tracked signature HTML" : "Tracking image HTML"}
                      value={copyBlocked ? "Copying is unavailable. Check the saved recipient and do-not-contact status." : emailContent(selected.pixelUrl, data.ownerEmail, emailFormat, includeOptOut ? selected.optOutUrl : null).html}
                      onFocus={(event) => event.target.select()}
                      rows={4}
                      spellCheck={false}
                    />
                    <p>
                      Copying this source as plain text into an email does not
                      insert an image.
                    </p>
                  </details>
                  {copyNotice && (
                    <p className="copy-notice" role="status">
                      {copyNotice}
                    </p>
                  )}
                  <p className="compatibility-note">
                    Gmail can keep images blocked until the recipient allows
                    them. Your contact text stays readable. Image loads may
                    come from Google’s proxy and don’t prove a human read.
                  </p>
                  <p className="compatibility-note">
                    Outlook on iPhone: insertion method not yet verified.{" "}
                    <button
                      className="text-button"
                      onClick={() => setDialog("guide")}
                    >
                      See how to test
                    </button>
                  </p>
                  <div className="detail-divider" />
                  <div className="workflow-step">
                    <span className="step-number">2</span>
                    <div>
                      <h3>Add your private context</h3>
                      <p>Labels stay private. You can update them anytime.</p>
                    </div>
                  </div>
                  <form
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      void updatePixel();
                    }}
                    className="details-form"
                  >
                    <label>
                      Message label
                      <input
                        maxLength={150}
                        value={draft.label}
                        onChange={(event) =>
                          setDraft({ ...draft, label: event.target.value })
                        }
                        placeholder="e.g. Website proposal"
                      />
                    </label>
                    <label>
                      Recipient <span className="optional">optional</span>
                      <input
                        maxLength={254}
                        value={draft.recipient}
                        onChange={(event) =>
                          setDraft({ ...draft, recipient: event.target.value })
                        }
                        type="email"
                        placeholder="name@example.com"
                      />
                    </label>
                    <label>
                      Notes <span className="optional">optional</span>
                      <textarea
                        maxLength={2000}
                        rows={2}
                        value={draft.notes}
                        onChange={(event) =>
                          setDraft({ ...draft, notes: event.target.value })
                        }
                        placeholder="A little context for your follow-up"
                      />
                    </label>
                    <button
                      className="button secondary full-width"
                      type="submit"
                      disabled={!dirty || !!busy || offline}
                    >
                      {busy === "save" ? "Saving…" : "Save details"}
                    </button>
                  </form>
                  </>}
                  <div className="pixel-retention">
                    <strong>Record retention</strong>
                    {selected.hasRecordedLoad ? (
                      <p>
                        Kept permanently after its first recorded load, including
                        activity and saved request details. You can still clear
                        activity or delete this pixel yourself.
                      </p>
                    ) : (
                      <>
                        <label className="retention-choice">
                          <input
                            type="checkbox"
                            checked={selected.preserveUnloaded}
                            disabled={!!busy || offline}
                            onChange={(event) => void preserveUnloadedPixel(event.target.checked)}
                          />
                          <span>Keep this pixel even if it never loads</span>
                        </label>
                        <p>
                          {selected.preserveUnloaded
                            ? "This record is protected from automatic cleanup."
                            : data.settings.keepUnloadedPixels
                              ? "Your preferences keep all never-loaded pixels. This checkbox also protects this pixel if you turn 90-day cleanup back on."
                              : "If it never records a load, this pixel becomes eligible for cleanup after 90 days, once its 89-day report is accepted by the email service. Unsent or failed reports keep the record here. Any recorded load makes its history permanent."}
                        </p>
                      </>
                    )}
                  </div>
                  <section className="pixel-report" aria-label="89-day pixel report">
                    <div className="pixel-report-heading">
                      <h3>89-day report</h3>
                      <button className="icon-button" onClick={() => void loadPixelReport()} disabled={pixelReportLoading || offline} aria-label="Refresh pixel report status">
                        <Icon name="refresh" size={15} />
                      </button>
                    </div>
                    <p>Scheduled from <time dateTime={reportDueAt(selected.createdAt)}>{formatDate(reportDueAt(selected.createdAt), true)}</time>, 89 days after creation.</p>
                    {pixelReportLoading && <p className="quiet-note" role="status">Checking report status…</p>}
                    {pixelReportError && <p className="field-error" role="alert">{pixelReportError}</p>}
                    {!pixelReportLoading && !pixelReportError && (
                      <>
                        <span className="report-status" data-status={pixelReport?.status || "scheduled"}>
                          {pixelReport ? reportStatusNames[pixelReport.status] : "Scheduled"}
                        </span>
                        <p className="quiet-note">
                          {pixelReport ? "A saved snapshot is available." : "A snapshot is created when scheduled processing reaches this date."}
                          {!selected.hasRecordedLoad ? " Never-loaded pixels receive a report too." : ""}
                        </p>
                      </>
                    )}
                    {!data.notificationConfigured && <p className="report-warning">Reports will queue, but won’t be emailed until sending is configured.</p>}
                    <button className="text-button" onClick={() => openReports(pixelReport)}>
                      {pixelReport ? "View report" : "Browse reports"} <Icon name="arrow" size={14} />
                    </button>
                  </section>
                  <div className="detail-divider" />
                  <div className="timeline-heading">
                    <h3>
                      Image activity <span>{selected.loadCount}</span>
                    </h3>
                    <button
                      className="icon-button"
                      onClick={() => void loadEvents()}
                      aria-label="Refresh image activity"
                      disabled={eventsLoading}
                    >
                      <Icon name="refresh" size={15} />
                    </button>
                  </div>
                  {eventsLoading && (
                    <p className="quiet-note" role="status">
                      Loading activity…
                    </p>
                  )}
                  {eventsError && (
                    <p className="field-error" role="alert">
                      {eventsError}
                    </p>
                  )}
                  {!eventsLoading && !eventsError && events.length === 0 && (
                    <div className="timeline-empty">
                      <span className="live-dot" />
                      <p>{selected.status === "armed" ? "No image requests recorded yet." : "No saved requests. Tracking is off."}</p>
                    </div>
                  )}
                  <ol className="timeline">
                    {events.map((event) => (
                      <li key={event.id}>
                        <span className="timeline-dot" />
                        <strong>Image loaded</strong>
                        <time
                          dateTime={event.createdAt}
                          title={event.createdAt}
                        >
                          {formatDate(event.createdAt, true)}
                        </time>
                        {event.metadata ? (
                          <div className="event-summary">
                            <p>{requestLocation(event.metadata)} <span>· approximate</span></p>
                            <p>{event.metadata.proxy
                              ? `${event.metadata.proxy} · reported proxy`
                              : [event.metadata.client, event.metadata.platform, event.metadata.device].filter(Boolean).join(" · ") || "Client and device unavailable"}</p>
                            {event.metadata.network && <p>{event.metadata.network}</p>}
                          </div>
                        ) : (
                          <p className="event-summary event-unavailable">Location and device details weren’t collected for this load.</p>
                        )}
                        {event.phase === "before_arming" && (
                          <small>Recorded before activation — earlier behavior</small>
                        )}
                        <RequestDetails metadata={event.metadata} />
                      </li>
                    ))}
                  </ol>
                  {eventsCursor && (
                    <button
                      className="secondary-button history-more"
                      disabled={eventsLoading || offline}
                      onClick={() => void loadEvents(false, eventsCursor)}
                    >
                      {eventsLoading ? "Loading earlier requests…" : "Load earlier requests"}
                    </button>
                  )}
                  {events.length > 0 && (
                    <p className="quiet-note">
                      {events.length} recorded {events.length === 1 ? "request" : "requests"} shown, newest first.
                      {eventsCursor ? " Load earlier requests to see more." : " End of retained history."}
                      {eventsExpandedRef.current ? " Refresh to include new requests." : ""}
                      {" "}Times use your browser’s time zone; request location is approximate and may belong to a proxy. A load does not confirm reading.
                    </p>
                  )}
                  {(!selected.outreachId || ["cancelled", "blocked"].includes(selected.outreachState ?? "")) && <div className="detail-actions">
                    {!selected.outreachId && selected.status !== "archived" && (
                      <button
                        className="text-button"
                        disabled={!!busy || offline}
                        onClick={() => void updatePixel("archived")}
                      >
                        <Icon name="archive" size={15} /> Archive
                      </button>
                    )}
                    {!selected.outreachId && selected.status === "archived" && (
                      <button
                        className="text-button"
                        disabled={!!busy || offline}
                        onClick={() => void updatePixel("paused")}
                      >
                        Restore as inactive
                      </button>
                    )}
                    <button
                      className="text-button danger-text"
                      onClick={() => setDialog("delete")}
                    >
                      <Icon name="trash" size={15} /> Delete
                    </button>
                    {selected.loadCount > 0 && (
                      <button
                        className="text-button"
                        onClick={() => setDialog("clear")}
                      >
                        Clear activity
                      </button>
                    )}
                  </div>}
                </section>
              ) : (
                <>
                  <section className="guide-card">
                    <div className="guide-icon">
                      <Icon name="activity" size={23} />
                    </div>
                    <div className="eyebrow">A SIMPLE WORKFLOW</div>
                    <h2>
                      Send as usual.
                      <br />
                      Keep the context.
                    </h2>
                    <ol className="getting-started">
                      <li>
                        <span>01</span>
                        <div>
                          <strong>Prepare your email</strong>
                          <p>Copy a fresh signature or pixel while tracking is off.</p>
                        </div>
                      </li>
                      <li>
                        <span>02</span>
                        <div>
                          <strong>Start, then press Send</strong>
                          <p>Start tracking immediately before sending.</p>
                        </div>
                      </li>
                      <li>
                        <span>03</span>
                        <div>
                          <strong>Review your activity</strong>
                          <p>Stop tracking when finished. Your saved history stays.</p>
                        </div>
                      </li>
                    </ol>
                    <button
                      className="text-button"
                      onClick={() => setDialog("guide")}
                    >
                      A closer look <Icon name="arrow" size={16} />
                    </button>
                  </section>
                  <section className="honesty-card">
                    <Icon name="shield" size={18} />
                    <div>
                      <h3>A signal, not a read receipt.</h3>
                      <p>
                        Image activity adds context. Privacy tools can preload
                        or block images, so a load doesn’t prove someone read
                        your message.
                      </p>
                    </div>
                  </section>
                </>
              )}
            </aside>
          </div>
          <footer className="workspace-footer">
            <span>
              SOLURE DIGITAL WORKS <span className="footer-dot">/</span> MADE
              FOR YOUR WORKDAY
            </span>
            <span>Private by design.</span>
          </footer>
          </>}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
      {dialog === "contacts" && (
        <Dialog title="Do not contact" onClose={() => setDialog(null)} wide>
          <div className="dialog-body contacts-body">
            <p>Addresses that must not receive further sales outreach from Solure. Confirmed web opt-outs are saved here; refresh to check for new requests. Add reply-based requests below.</p>
            <p className="contacts-limit-note">Maildesk blocks new tracking and copy tools for matching saved recipients. It cannot block Outlook’s Send button. Check this list before sending manually. Entries are kept independently of message history and cleanup.</p>
            <form className="contact-add-form" onSubmit={(event) => void addDoNotContact(event)}>
              <label>Record a do-not-contact request<input type="email" required maxLength={254} value={contactRecipient} onChange={(event) => setContactRecipient(event.target.value)} placeholder="name@example.com" /></label>
              <button className="button secondary" type="submit" disabled={!!busy || offline}>{busy === "contact-add" ? "Adding…" : "Add address"}</button>
            </form>
            <div className="contacts-search-row"><label className="search contacts-search"><Icon name="search" size={16} /><input aria-label="Search do-not-contact addresses" maxLength={200} value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search addresses" /></label><button className="icon-button" aria-label="Refresh do-not-contact list" onClick={() => void loadContacts()} disabled={contactsLoading || offline}><Icon name="refresh" size={17} /></button></div>
            {contactsError && <p className="field-error" role="alert">{contactsError}</p>}
            {contactsLoading && <p className="quiet-note" role="status">Loading addresses…</p>}
            {!contactsLoading && !contactsError && contacts.length === 0 && <p className="contacts-empty">{contactSearch ? "No matching addresses." : "No do-not-contact requests recorded yet."}</p>}
            <ul className="contact-preference-list">
              {contacts.map((entry) => <li key={entry.recipient}><strong>{entry.recipient}</strong><span>{entry.source === "recipient" ? "Confirmed through opt-out link" : "Recorded by you"} · <time dateTime={entry.createdAt}>{formatDate(entry.createdAt, true)}</time></span></li>)}
            </ul>
            {contactsHasMore && <button className="button secondary" disabled={contactsLoading || offline} onClick={() => void loadContacts(contactsNextOffset)}>Load more addresses</button>}
            <p className="quiet-note">{contacts.length} of {contactsTotal} {contactsTotal === 1 ? "address" : "addresses"}</p>
          </div>
          <div className="dialog-footer"><button className="button primary" onClick={() => setDialog(null)}>Done</button></div>
        </Dialog>
      )}
      {dialog === "guide" && (
        <Dialog
          title="A useful signal, with clear limits."
          onClose={() => setDialog(null)}
        >
          <div className="dialog-body prose">
            <p>
              Each message has its own remote image: a signature logo or a
              transparent pixel. While tracking is active, a request creates an activity
              event. Your message label,
              recipient and notes stay in your private workspace.
            </p>
            <h3>Outreach preferences</h3>
            <p>Save the message’s recipient, then create its opt-out footer. Copying a footer does not opt anyone out or start tracking. The recipient must confirm on the public page; simply viewing the link has no effect. Old links keep their original recipient even after editing or deleting the message.</p>
            <p>Confirmed requests and addresses you add manually remain on the separate do-not-contact list. Maildesk blocks new tracking and copy tools for those addresses, but cannot stop a message sent directly in Outlook. This preference stops future sales outreach; it does not delete historical image activity.</p>
            <h3>Test your Outlook insertion method first</h3>
            <ol>
              <li>
                Create a pixel, choose its email format and prepare your email
                while tracking is off. Use “Copy for Outlook,” or insert its HTML
                through a client that supports HTML insertion.
              </li>
              <li>Return to Maildesk and click “Start tracking & email me” immediately before you press Send in Outlook. Send this test to an inbox you control.</li>
              <li>
                Inspect the received message source. Its image must still
                reference the pixel’s HTTPS address, rather than an embedded
                attachment or a <code>cid:</code> address.
              </li>
              <li>Check the activity after allowing remote images to load.</li>
            </ol>
            <p>
              Normal image insertion can embed the file. A pasted URL or pasted
              HTML source alone is not a tracking image. Outlook on iPhone
              remains unverified until this test passes.
            </p>
            <h3>Active means recording; inactive means off</h3>
            <p>
              New messages start inactive. Copying never starts tracking. Inactive,
              stopped and archived messages display the image normally but save
              no new requests or request details and create no new load emails.
              Existing history stays saved. Older pre-activation activity is
              labeled as earlier behavior.
            </p>
            <p>
              “Start tracking & email me” activates recording and image-load
              emails together. The first new load after each start can email
              you, even after a stop and restart. Starting also resumes the
              global email preference for other active messages. “Stop tracking”
              stops recording and new load emails; an email already being
              delivered can still arrive. The separate 89-day report remains scheduled.
            </p>
            <p>
              Maildesk doesn’t control Outlook’s Send button, so switching apps
              is manual. Once tracking is active, your own email composer, a preview or a
              security scanner can be the first image load. That load can trigger
              the first email; it does not identify the recipient.
            </p>
            <p>
              Copy a fresh tracked signature for every message. Saving one as
              your reusable Outlook signature combines those messages’ activity.
              The logo signature uses one tracked image and real contact text;
              no additional invisible pixel is needed. The dashboard preview
              uses a separate untracked image.
            </p>
            <h3>What a load can tell you</h3>
            <p>
              It shows that something requested the image. Previews, security
              scanners and privacy services may request it before a person reads
              the email. Image blocking and caching can hide later activity.
            </p>
            <p>
              One pixel belongs to one message. If you send it to several
              people, or someone forwards the message, the pixel cannot identify
              who loaded it.
            </p>
            <h3>Optional request details</h3>
            <p>
              By default, active image loads record activity times without request
              details. In preferences, you can choose to save the request IP,
              approximate location, network, and reported device and client for
              future loads. Expand “Request details” in the activity history to
              see what was available.
            </p>
            <p>
              These details may belong to an image proxy or privacy service,
              rather than the person reading your email. Location is approximate
              and does not use GPS. Reported client information and proxy hints
              can be incomplete or inaccurate.
            </p>
            <p>
              Turning collection off stops saving details for future loads.
              Once a pixel records a load, its history and saved details are kept
              permanently unless you clear the activity or delete the pixel.
              Never-loaded pixels become eligible for cleanup after 90 days
              only once their report is accepted by the email service, unless
              you keep them individually or in preferences. Unsent or failed
              reports keep the pixel here. A proxy or scanner request also
              counts as a load.
            </p>
            <h3>Your 89-day pixel report</h3>
            <p>
              Every pixel gets one saved report after 89 days from creation,
              including pixels that never load. Reports are emailed to{" "}
              {data.ownerEmail}, independently of image-load alert preferences.
              If sending is not configured, reports queue until it is ready.
            </p>
            <p>
              Reports include a summary and a private link to the full load
              history. Emails omit notes, raw IP addresses and User-Agent text.
              “Accepted by email service” does not confirm inbox delivery.
              Automatic cleanup can remove a never-loaded pixel while keeping
              its report; the history link will then be unavailable. Deleting
              a pixel yourself also removes its saved report.
            </p>
            <h3>After sending</h3>
            <p>
              Return here to review saved requests or update the private label.
              Keep tracking active while you want new activity recorded. Stop it
              when you’re finished; the existing history stays here. Loads that
              happen while tracking is off are not saved or backfilled.
            </p>
          </div>
          <div className="dialog-footer">
            <button className="button primary" onClick={() => setDialog(null)}>
              Got it
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "settings" && settingsDraft && (
        <Dialog title="Your preferences" onClose={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action("settings", async () => {
                // Omit unchanged fields so an older tab cannot restore a
                // collection preference changed in another window.
                const changes = Object.fromEntries(
                  Object.entries(settingsDraft).filter(
                    ([key, value]) =>
                      value !== settingsBaselineRef.current?.[key as keyof Settings],
                  ),
                );
                await request("/api/settings", {
                  method: "PATCH",
                  body: JSON.stringify(changes),
                });
                await load();
                setDialog(null);
                setToast("Preferences saved.");
              });
            }}
          >
            <div className="dialog-body">
              <div className="setting-row">
                <div>
                  <strong>Image-load emails for all active messages</strong>
                  <p>
                    {data.development
                      ? "Simulate email alerts locally. No email is sent."
                      : `Send load emails to ${data.ownerEmail}. Turning this off pauses emails, while active messages keep recording. Starting tracking resumes these emails.`}
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Enable image-load emails for all active messages"
                  checked={settingsDraft.emailEnabled}
                  disabled={!data.notificationConfigured}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      emailEnabled: event.target.checked,
                    })
                  }
                />
              </div>
              {(data.development || !data.notificationConfigured) && (
                <p className="inline-note">
                  {data.development
                    ? "Local mode records test deliveries without sending email."
                    : "Email delivery needs sender configuration. In-app activity remains available."}
                </p>
              )}
              <div className="settings-report-note">
                <strong>89-day pixel reports</strong>
                <p>
                  Every pixel gets a report after 89 days, including those
                  that never load. Reports go to {data.ownerEmail}, even when
                  image-load email alerts are off.
                </p>
                <p>
                  Emails include a summary and private history link, and omit
                  notes, raw IP addresses and User-Agent text.
                </p>
                {!data.notificationConfigured && <p className="report-warning">Reports will queue, but won’t be emailed until sending is configured.</p>}
                {data.development && <p>Local mode records test reports without sending email.</p>}
              </div>
              <div className="setting-row">
                <div>
                  <strong>Repeat alerts</strong>
                  <p>
                    After the first load email in each tracking session,
                    allow another at most once per hour.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Enable repeat alerts"
                  checked={settingsDraft.repeatAlerts}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      repeatAlerts: event.target.checked,
                    })
                  }
                />
              </div>
              <div className="setting-row request-details-setting">
                <div>
                  <strong id="request-details-setting-title">
                    Collect request details
                  </strong>
                  <p id="request-details-setting-description">
                    Save the request IP, approximate location, network, and
                    reported device and client for future image loads. Off by
                    default.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-labelledby="request-details-setting-title"
                  aria-describedby="request-details-setting-description request-details-privacy"
                  checked={settingsDraft.captureRequestDetails}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      captureRequestDetails: event.target.checked,
                    })
                  }
                />
              </div>
              <p id="request-details-privacy" className="request-privacy-note">
                Proxies can replace reader information; this is request data,
                not a person’s identity or GPS location. Turning this off stops
                future collection. Saved details are kept permanently after a
                recorded load unless you clear activity or delete the pixel.
              </p>
              <div className="setting-row">
                <div>
                  <strong id="keep-unloaded-title">Keep all never-loaded pixels</strong>
                  <p id="keep-unloaded-description">
                    When off, never-loaded pixels can be deleted after 90 days,
                    once their report is accepted by the email service, unless
                    you keep a specific pixel. Turn on to keep all of them
                    permanently.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-labelledby="keep-unloaded-title"
                  aria-describedby="keep-unloaded-description"
                  checked={settingsDraft.keepUnloadedPixels}
                  onChange={(event) => setSettingsDraft({
                    ...settingsDraft,
                    keepUnloadedPixels: event.target.checked,
                  })}
                />
              </div>
              <p className="quiet-note">
                Loaded pixels, activity, saved request details and notifications
                are kept permanently, including when archived. Clearing activity
                or deleting a pixel still removes that data. Turning this setting
                off makes unprotected never-loaded pixels older than 90 days
                eligible for cleanup once their report is accepted by the email
                service. Unsent or failed reports hold the record.
              </p>
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={!!busy || offline}
              >
                {busy === "settings" ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {dialog === "reports" && (
        <Dialog title="89-day pixel reports" onClose={() => setDialog(null)} wide>
          <div className="report-dialog-intro">
            <p>Every pixel gets one report after 89 days, including never-loaded pixels. Reports are emailed only to <strong>{data.ownerEmail}</strong>.</p>
            <p>Emails contain a summary and private history link. Notes, raw IP addresses and User-Agent text stay out of the email.</p>
            {!data.notificationConfigured && <p className="report-warning">Reports will queue, but won’t be emailed until sending is configured.</p>}
            {data.development && <p className="report-warning">Local mode records test reports without sending email.</p>}
          </div>
          <div className="reports-toolbar">
            {focusedReport ? (
              <button className="text-button" onClick={() => setFocusedReport(null)}>All reports</button>
            ) : <span>{reports.length} of {reportsTotal} saved reports</span>}
            <button ref={reportsRefreshRef} className="text-button" disabled={reportsLoading || offline} onClick={() => void loadReports()}>
              <Icon name="refresh" size={15} /> Refresh
            </button>
          </div>
          {reportsError && <p className="field-error report-list-error" role="alert">{reportsError} Use Refresh to retry.</p>}
          {reportsLoading && <p className="report-list-status" role="status">Loading reports…</p>}
          <div className="reports-list">
            {focusedReport ? (
              <ReportCard report={focusedReport} expanded busy={busy} offline={offline}
                onRetry={(id) => void retryReport(id)} onView={(id) => void viewReportPixel(id)} onDelete={setReportToDelete} />
            ) : reports.length > 0 ? reports.map((report) => (
              <ReportCard key={report.id} report={report} busy={busy} offline={offline}
                onRetry={(id) => void retryReport(id)} onView={(id) => void viewReportPixel(id)} onDelete={setReportToDelete} />
            )) : !reportsLoading && !reportsError ? (
              <div className="reports-empty">
                <Icon name="report" size={30} />
                <h3>No saved reports yet.</h3>
                <p>A pixel’s report appears here when scheduled processing reaches 89 days after its creation. Pixels that never load are included.</p>
              </div>
            ) : null}
          </div>
          {!focusedReport && reportsHasMore && (
            <div className="reports-more">
              <button className="button secondary" disabled={reportsLoading || offline} onClick={() => void loadReports(reportsNextOffset)}>
                {reportsLoading ? "Loading…" : "Load more reports"}
              </button>
            </div>
          )}
          {error && <p className="field-error dialog-error" role="alert">{error}</p>}
          <div className="report-dialog-footer">
            <p>Snapshots stay as recorded. A saved report is retained if automatic cleanup removes a never-loaded pixel; its history link may then be unavailable.</p>
            {reportsExpandedRef.current && <p>Refresh starts again with the newest reports.</p>}
          </div>
        </Dialog>
      )}
      {reportToDelete && (
        <Dialog title="Delete this saved report?" onClose={() => setReportToDelete(null)}>
          <div className="dialog-body">
            <p>This permanently removes the saved report for a pixel that is no longer available. It cannot be undone, and it cannot recall an email already sent.</p>
            <strong>{reportToDelete.label || "Untitled message"}</strong>
            {error && <p className="field-error" role="alert">{error}</p>}
          </div>
          <div className="dialog-footer">
            <button className="button secondary" onClick={() => setReportToDelete(null)}>Keep report</button>
            <button className="button destructive" disabled={!!busy || offline} onClick={() => void action("report-delete", async () => {
              const id = reportToDelete.id;
              await request(`/api/reports/${id}`, { method: "DELETE" });
              setFocusedReport((current) => current?.id === id ? null : current);
              await loadReports();
              setReportToDelete(null);
              setToast("Saved report deleted.");
              window.setTimeout(() => reportsRefreshRef.current?.focus(), 0);
            })}>
              {busy === "report-delete" ? "Deleting…" : "Delete saved report"}
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "notifications" && (
        <Dialog title="Notifications" onClose={() => setDialog(null)} wide>
          <div className="notification-summary">
            <span>
              {unread} unread notification{unread === 1 ? "" : "s"}
              {data.notifications.length === 200 ? " · Showing latest 200" : ""}
            </span>
            <button
              className="text-button"
              disabled={!!busy || unread === 0}
              onClick={() => void markRead()}
            >
              Mark all read
            </button>
          </div>
          <div className="notification-list">
            {data.notifications.length === 0 ? (
              <div className="notification-empty">
                <Icon name="bell" size={30} />
                <h3>You’re all caught up.</h3>
                <p>
                  When an active message’s image loads, its notification will appear here.
                </p>
              </div>
            ) : (
              data.notifications.map((notification: Notification) => (
                <article
                  className={
                    !notification.readAt
                      ? "notification-entry unread"
                      : "notification-entry"
                  }
                  key={notification.id}
                >
                  <span className="notification-entry-icon">
                    <Icon name="activity" />
                  </span>
                  <div>
                    <strong>
                      Image loaded — {notification.label || "Untitled message"}
                    </strong>
                    <time dateTime={notification.createdAt}>
                      {formatDate(notification.createdAt, true)}
                    </time>
                    <span className="delivery-label">
                      {deliveryNames[notification.status]}
                    </span>
                    {notification.lastError && (
                      <p className="field-error">{notification.lastError}</p>
                    )}
                    <button
                      className="text-button"
                      onClick={() =>
                        void action("view", async () => {
                          const pixel = await request<Pixel>(
                            `/api/pixels/${notification.pixelId}`,
                          );
                          choose(pixel);
                          setDialog(null);
                        })
                      }
                    >
                      View message <Icon name="arrow" size={14} />
                    </button>
                  </div>
                  {!notification.readAt && (
                    <button
                      className="icon-button"
                      disabled={!!busy}
                      aria-label={`Mark notification for ${notification.label || "untitled message"} as read`}
                      onClick={() => void markRead([notification.id])}
                    >
                      <Icon name="check" />
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
          {error && (
            <p role="alert" className="field-error dialog-error">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {(dialog === "delete" || dialog === "clear") && selected && (
        <Dialog
          title={
            dialog === "delete"
              ? "Delete this message?"
              : "Clear activity history?"
          }
          onClose={() => setDialog(null)}
        >
          <div className="dialog-body">
            <p>
              {dialog === "delete"
                ? "This removes the pixel’s label, notes, activity, saved request details, notifications and saved report. Future image requests will not be tracked. This cannot be undone or recall report emails already sent."
                : "This removes the recorded activity, including saved request details, and resets the summary counts for this pixel. Its label, notes, any saved report snapshot and current alert state stay in place. This cannot be undone."}
            </p>
            <strong>{selected.label || "Untitled message"}</strong>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Keep it
            </button>
            <button
              className="button destructive"
              disabled={!!busy || offline}
              onClick={() =>
                void action("delete", async () => {
                  await request(
                    `/api/pixels/${selected.id}${dialog === "clear" ? "/events" : ""}`,
                    { method: "DELETE" },
                  );
                  if (dialog === "delete") {
                    setSelectedId(null);
                    setSelectedRecord(null);
                    selectedIdRef.current = null;
                  }
                  await load();
                  await loadList();
                  if (dialog === "clear") await loadEvents();
                  setDialog(null);
                  setToast(
                    dialog === "delete"
                      ? "Message deleted."
                      : "Activity cleared.",
                  );
                })
              }
            >
              {busy === "delete"
                ? "Removing…"
                : dialog === "delete"
                  ? "Delete message"
                  : "Clear activity"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: IconName;
  footnote: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">
        {label}
        <Icon name={icon} size={18} />
      </div>
      <strong className="stat-value">{value.toLocaleString()}</strong>
      <p>{footnote}</p>
    </article>
  );
}
