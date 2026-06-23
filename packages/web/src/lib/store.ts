import { create } from 'zustand';
import { api } from './api';

export interface Profile {
  id: string;
  username: string;
  bio: string;
  full_name: string;
  followers: number;
  following: number;
  posts_count: number;
  is_private: boolean;
  is_verified: boolean;
  is_business: boolean;
  external_url: string;
  niche_id: string;
  niche_label?: string;
  score: number;
  score_details?: any;
  status: string;
  manual_signals: string[];
  reviewer_notes: string;
  discovery_source: string;
  discovery_date: string;
  engagement_rate: number | null;
  avg_likes: number | null;
}

export interface Niche {
  id: string;
  label: string;
  weight: number;
  keywords: string[];
  profile_count: number;
  customer_count: number;
  stats: {
    totalFeedback: number;
    approvalRate: number | null;
    conversionRate: number | null;
  };
}

export interface PipelineRun {
  id: string;
  strategy: string;
  status: string;
  input_config: any;
  stats: any;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface FunnelData {
  steps: { label: string; value: number; pct: number }[];
  rejected: number;
  pending: number;
}

interface AppState {
  // State
  profiles: Profile[];
  niches: Niche[];
  customers: any[];
  pipelineRuns: PipelineRun[];
  funnel: FunnelData | null;
  queueCount: number;
  stats: any;
  throughput: any;
  settings: any;
  loading: boolean;
  error: string | null;
  toast: string | null;

  // Actions
  loadState: () => Promise<void>;
  fetchProfiles: (status?: string, page?: number, limit?: number) => Promise<{ data: Profile[]; pagination: any }>;
  fetchNextProfile: (niche?: string) => Promise<Profile | null>;
  submitFeedback: (profileId: string, action: string, signals?: string[]) => Promise<void>;
  toggleSignal: (profileId: string, signal: string) => Promise<void>;
  fetchNiches: () => Promise<Niche[]>;
  adjustNicheWeight: (nicheId: string, delta: number) => Promise<void>;
  recalcWeights: () => Promise<void>;
  fetchFunnel: () => Promise<FunnelData>;
  fetchThroughput: () => Promise<any>;
  fetchStats: () => Promise<any>;
  fetchPipelineRuns: () => Promise<PipelineRun[]>;
  fetchSettings: () => Promise<any>;
  updateSettings: (key: string, value: any) => Promise<void>;
  importCSV: (csv: string, source?: string) => Promise<any>;
  generateBatch: (size?: number) => Promise<any>;
  addCustomer: (username: string, nicheId: string, notes?: string) => Promise<void>;
  showToast: (msg: string) => void;
  clearError: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  profiles: [],
  niches: [],
  customers: [],
  pipelineRuns: [],
  funnel: null,
  queueCount: 0,
  stats: null,
  throughput: null,
  settings: null,
  loading: true,
  error: null,
  toast: null,

  loadState: async () => {
    try {
      set({ loading: true, error: null });
      const [stats, funnel, niches, settings] = await Promise.all([
        api.get('/stats/overview'),
        api.get('/pipeline/funnel'),
        api.get('/niches'),
        api.get('/settings')
      ]);
      set({
        stats: stats.data,
        funnel: funnel.data,
        niches: niches.data,
        queueCount: stats.data?.profiles?.pending || 0,
        settings: settings.data,
        loading: false,
        error: null
      });
    } catch (err: any) {
      set({ loading: false, error: err.message || 'Error al conectar con el servidor' });
    }
  },

  fetchProfiles: async (status = 'nuevo', page = 1, limit = 25) => {
    const res = await api.get('/profiles', { status, page, limit, sort: 'score', order: 'desc' });
    return res;
  },

  fetchNextProfile: async (niche?: string) => {
    const params: any = {};
    if (niche) params.niche = niche;
    const res = await api.get('/profiles/next', params);
    return res.data || null;
  },

  submitFeedback: async (profileId, action, signals) => {
    await api.post(`/profiles/${profileId}/feedback`, { action, signals });
    set(s => ({ queueCount: Math.max(0, s.queueCount - 1) }));
    get().fetchStats();
  },

  toggleSignal: async (profileId, signal) => {
    await api.put(`/profiles/${profileId}/signals`, { signal });
  },

  fetchNiches: async () => {
    const res = await api.get('/niches');
    set({ niches: res.data });
    return res.data;
  },

  adjustNicheWeight: async (nicheId, delta) => {
    await api.put(`/niches/${nicheId}/weight`, { delta });
    get().fetchNiches();
  },

  recalcWeights: async () => {
    await api.post('/niches/recalc');
    get().fetchNiches();
  },

  fetchFunnel: async () => {
    const res = await api.get('/pipeline/funnel');
    set({ funnel: res.data });
    return res.data;
  },

  fetchThroughput: async () => {
    const res = await api.get('/stats/throughput');
    set({ throughput: res.data });
    return res.data;
  },

  fetchStats: async () => {
    const res = await api.get('/stats/overview');
    set({ stats: res.data, queueCount: res.data?.profiles?.pending || 0 });
    return res.data;
  },

  fetchPipelineRuns: async () => {
    const res = await api.get('/pipeline/runs', { limit: '20' });
    set({ pipelineRuns: res.data });
    return res.data;
  },

  fetchLivePipeline: async () => {
    const res = await api.get('/pipeline/live');
    return res.data;
  },

  triggerStrategy: async (strategyId: string) => {
    return api.post(`/pipeline/strategies/${strategyId}/run`);
  },

  toggleStrategy: async (strategyId: string, enabled: boolean) => {
    return api.put(`/pipeline/strategies/${strategyId}`, { enabled });
  },

  fetchSettings: async () => {
    const res = await api.get('/settings');
    set({ settings: res.data });
    return res.data;
  },

  updateSettings: async (key, value) => {
    await api.put(`/settings/${key}`, { value });
    get().fetchSettings();
  },

  importCSV: async (csv, source = 'csv_upload') => {
    const res = await api.post('/import/csv', { csv, source });
    get().fetchStats();
    return res.data;
  },

  generateBatch: async (size = 14) => {
    return api.post('/batches/generate', { size });
  },

  addCustomer: async (username, nicheId, notes) => {
    await api.post('/customers', { username, nicheId, notes });
  },

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 2500);
  },

  clearError: () => set({ error: null })
}));
