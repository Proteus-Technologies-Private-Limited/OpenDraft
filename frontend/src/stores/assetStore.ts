import { create } from 'zustand';

export interface Asset {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  tags: string[];
  created_at: string;
}

interface AssetState {
  assets: Asset[];
  setAssets: (assets: Asset[]) => void;
  assetManagerOpen: boolean;
  toggleAssetManager: () => void;
  setAssetManagerOpen: (open: boolean) => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],
  setAssets: (assets) => set({ assets }),
  assetManagerOpen: false,
  toggleAssetManager: () => set((s) => ({ assetManagerOpen: !s.assetManagerOpen })),
  setAssetManagerOpen: (open) => set({ assetManagerOpen: open }),
}));
