import type { BackupCodec, TravelCatalogue, TravelPlatform } from '../services/contracts'
export declare function createBackupKernel(dependencies: { catalogue: TravelCatalogue; platform: TravelPlatform }): BackupCodec
