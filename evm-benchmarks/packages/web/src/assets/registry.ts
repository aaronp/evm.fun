import { createAssetRegistry } from '@evmb/assets'
import { kv, type Kv } from '../store/kv'

export const createWebAssets = (kv: Kv) => createAssetRegistry(kv)
export const assetRegistry = createWebAssets(kv)
