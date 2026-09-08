import type { BackupCodec, LocalStoreKernel, TravelCatalogue, TravelPlatform } from '../services/contracts'
export declare function createLocalStoreKernel(dependencies: { catalogue: TravelCatalogue; backup: BackupCodec; platform: TravelPlatform }, options?: { dbName?: string }): LocalStoreKernel
