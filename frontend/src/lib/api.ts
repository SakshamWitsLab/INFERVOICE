export type MachineStatus = "unknown" | "online" | "offline" | "auth_error";

export interface StorageVolume {
  mount: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  pct_used: number;
}

export interface Sysinfo {
  computer_name: string | null;
  model_name: string | null;
  model: string | null;
  identifier: string | null;
  chip: string | null;
  cores_total: number | null;
  cores_performance: number | null;
  cores_efficiency: number | null;
  memory_gb: number | null;
  serial: string | null;
  os_name: string | null;
  os_version: string | null;
  os_build: string | null;
  uptime_seconds: number | null;
  load_avg: [number, number, number] | null;
  storage: StorageVolume[];
  disk_total_gb: number | null;
  disk_used_gb: number | null;
  disk_free_gb: number | null;
  disk_pct_used: number | null;
  collected_at: string;
}

export interface Machine {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  status: MachineStatus;
  error: string | null;
  specs: Sysinfo | null;
  models_root: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface DiscoveredHost {
  source: "mdns" | "subnet";
  host: string;
  port: number;
  name: string | null;
  registered: boolean;
}

export interface MetricSample {
  ts: string;
  cpu_pct: number;
  mem_pct: number;
  mem_used_gb: number;
  mem_total_gb: number;
  net_rx_kbps: number | null;
  net_tx_kbps: number | null;
}

export interface FleetEntry {
  machine_id: string;
  name: string;
  status: string;
  disk_pct: number | null;
  sample: MetricSample | null;
}

export interface NvidiaModelInfo {
  nim_id: string;
  family: string;
  hf_repo: string | null;
  description: string;
  downloadable: boolean;
  source: string;
  size_gb: number | null;
}

export interface Deployment {
  machine_id: string;
  machine_name: string;
  machine_online: boolean;
  nim_id: string;
  hf_repo: string;
  target_dir: string;
  disk_size: string | null;
}

export interface DownloadJob {
  id: string;
  machine_id: string;
  machine_name: string;
  nim_id: string;
  hf_repo: string;
  target_dir: string;
  status: "queued" | "downloading" | "done" | "failed" | "cancelled";
  error: string | null;
  remote_pid: number | null;
  log_tail: string | null;
  progress_pct: number | null;
  phase: string | null;
  files_done: number | null;
  files_total: number | null;
  created_at: string;
}

export interface RunnableModel extends NvidiaModelInfo {
  runnable: boolean;
}

export interface InferenceTask {
  id: string;
  machine_id: string;
  machine_name: string;
  nim_id: string;
  status: "queued" | "uploading" | "downloading_model" | "inferring" | "installing_runtime" | "done" | "failed" | "cancelled";
  transcript: string | null;
  error: string | null;
  wall_ms: number | null;
  progress_pct: number | null;
  phase: string | null;
  log_text: string | null;
}

export interface InferenceRunDetail {
  run: {
    id: string;
    model_id: string;
    audio_name: string;
    audio_duration: number | null;
    status: string;
    created_at: string;
  };
  tasks: InferenceTask[];
}

export interface InferenceRunSummary {
  id: string;
  model_id: string;
  model_ids?: string[];
  audio_name: string;
  status: string;
  created_at: string;
  machines: string[];
  done: number;
}

export interface ExecResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8747";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listMachines: () => req<Machine[]>("/api/machines"),
  getMachine: (id: string) => req<Machine>(`/api/machines/${id}`),
  getMetrics: (id: string) => req<MetricSample>(`/api/machines/${id}/metrics`),
  fleetMetrics: () => req<FleetEntry[]>("/api/metrics/fleet"),
  nvidiaKeyStatus: () =>
    req<{ configured: boolean; hint: string | null }>("/api/nvidia/key"),
  saveNvidiaKey: (api_key: string) =>
    req<{ ok: boolean; catalog_size: number }>("/api/nvidia/key", {
      method: "PUT",
      body: JSON.stringify({ api_key }),
    }),
  deleteNvidiaKey: () => req<{ ok: boolean }>("/api/nvidia/key", { method: "DELETE" }),
  nvidiaModels: () =>
    req<{ models: NvidiaModelInfo[]; live_error: string | null }>("/api/nvidia/models"),
  nvidiaDownloads: () => req<DownloadJob[]>("/api/nvidia/downloads"),
  startDownload: (machine_id: string, nim_id: string) =>
    req<DownloadJob>("/api/nvidia/downloads", {
      method: "POST",
      body: JSON.stringify({ machine_id, nim_id }),
    }),
  cancelDownload: (jobId: string) =>
    req<DownloadJob>(`/api/nvidia/downloads/${jobId}`, { method: "DELETE" }),
  installHfCli: (machineId: string) =>
    req<{ ok: boolean; output: string }>(`/api/nvidia/machines/${machineId}/install-hf-cli`, {
      method: "POST",
    }),
  deployments: (verify = false) =>
    req<{ deployments: Deployment[] }>(`/api/nvidia/deployments${verify ? "?verify=true" : ""}`),
  deleteDeployment: (machineId: string, nimId: string) =>
    req<{ ok: boolean; target_dir: string }>(
      `/api/nvidia/deployments/${machineId}/${encodeURIComponent(nimId)}`,
      { method: "DELETE" }
    ),
  modelsRoot: () => req<{ value: string | null }>("/api/nvidia/settings/models-root"),
  setModelsRoot: (path: string) =>
    req<{ ok: boolean; value: string }>("/api/nvidia/settings/models-root", {
      method: "PUT",
      body: JSON.stringify({ path }),
    }),
  updateMachine: (
    id: string,
    body: { name?: string; models_root?: string }
  ) =>
    req<Machine>(`/api/machines/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  inferenceCatalog: () =>
    req<{ models: RunnableModel[]; live_error: string | null }>("/api/inference/catalog"),
  deployedFor: (nimId: string) =>
    req<{ machines: { id: string; name: string }[] }>(`/api/inference/deployed/${nimId}`),
  createRun: (audio: File, modelId: string, machineIds: string[], durationSec: number) => {
    const fd = new FormData();
    fd.append("audio", audio);
    fd.append("model_id", modelId);
    fd.append("machine_ids", JSON.stringify(machineIds));
    fd.append("duration_sec", String(durationSec));
    return fetch(`${API_BASE}/api/inference/runs`, { method: "POST", body: fd })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
        return res.json() as Promise<{ run_id: string }>;
      });
  },
  createMultiRun: (
    audio: File,
    targets: { model_id: string; machine_ids: string[] }[],
    durationSec: number
  ) => {
    const fd = new FormData();
    fd.append("audio", audio);
    fd.append("targets_json", JSON.stringify(targets));
    fd.append("duration_sec", String(durationSec));
    return fetch(`${API_BASE}/api/inference/runs/multi`, { method: "POST", body: fd })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
        return res.json() as Promise<{ run_id: string }>;
      });
  },
  getRun: (id: string) => req<InferenceRunDetail>(`/api/inference/runs/${id}`),
  listRuns: () => req<{ runs: InferenceRunSummary[] }>("/api/inference/runs"),
  stopRun: (id: string) =>
    req<{ ok: boolean }>(`/api/inference/runs/${id}/stop`, { method: "POST" }),
  deleteRun: (id: string) =>
    req<{ ok: boolean }>(`/api/inference/runs/${id}`, { method: "DELETE" }),
  diagnoseMachine: (id: string) =>
    req<Record<string, string>>(`/api/machines/${id}/diagnose`, { method: "POST" }),
  installAsrRuntime: (machineId: string) =>
    req<{ ok: boolean; output: string }>(`/api/inference/install-runtime/${machineId}`, {
      method: "POST",
    }),
  addMachine: (body: { name?: string; host: string; port?: number; username: string }) =>
    req<Machine>("/api/machines", { method: "POST", body: JSON.stringify(body) }),
  renameMachine: (id: string, name: string) =>
    req<Machine>(`/api/machines/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteMachine: (id: string) => req<void>(`/api/machines/${id}`, { method: "DELETE" }),
  checkMachine: (id: string) => req<Machine>(`/api/machines/${id}/check`, { method: "POST" }),
  refreshMachine: (id: string) => req<Machine>(`/api/machines/${id}/refresh`, { method: "POST" }),
  execCommand: (id: string, command: string) =>
    req<ExecResult>(`/api/machines/${id}/exec`, { method: "POST", body: JSON.stringify({ command }) }),
  installKey: (id: string, password: string) =>
    req<{ installed: boolean; specs: Sysinfo | null }>(`/api/machines/${id}/install-key`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  mdnsList: () => req<{ hosts: DiscoveredHost[] }>("/api/discovery"),
  subnetScan: () => req<{ hosts: DiscoveredHost[] }>("/api/discovery/scan", { method: "POST" }),
};

export function wsTerminalUrl(machineId: string): string {
  return `${API_BASE.replace(/^http/, "ws")}/ws/terminal/${machineId}`;
}

export function fmtGB(gb: number | null | undefined, digits = 0): string {
  if (gb == null) return "—";
  if (gb >= 1024) return `${(gb / 1024).toFixed(digits || 1)} TB`;
  return `${gb.toFixed(digits)} GB`;
}

export function fmtUptime(seconds: number | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
