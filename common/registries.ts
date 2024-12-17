interface IRegistries {
  roleRegistry: string
  versionRegistry: string
  assetPluginRegistry: string
  daoFeeRegistry: string
}

interface IRegistryControl {
  owner: string
  feeRecipient: string
}

export interface RegistryChainRecord {
  registries: IRegistries
  registryControl: IRegistryControl
}

export const registryConfig: Record<string, RegistryChainRecord> = {
  '1': {
    registryControl: {
      owner: '0x0000000000000000000000000000000000000123',
      feeRecipient: '0x0000000000000000000000000000000000000123',
    },
    registries: {
      roleRegistry: '',
      versionRegistry: '',
      assetPluginRegistry: '',
      daoFeeRegistry: '',
    },
  },
  '8453': {
    registryControl: {
      owner: '0xe8259842e71f4E44F2F68D6bfbC15EDA56E63064',
      feeRecipient: '0x0000000000000000000000000000000000000123',
    },
    registries: {
      roleRegistry: '0xBc53d3e1C82F14cf40F69bF58fA4542b55091263',
      versionRegistry: '',
      assetPluginRegistry: '',
      daoFeeRegistry: '',
    },
  },
}

registryConfig['31337'] = registryConfig['1']
