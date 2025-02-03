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
      owner: '0xe8259842e71f4E44F2F68D6bfbC15EDA56E63064',
      feeRecipient: '',
    },
    registries: {
      roleRegistry: '0xE1eC57C8EE970280f237863910B606059e9641C9',
      versionRegistry: '',
      assetPluginRegistry: '',
      daoFeeRegistry: '',
    },
  },
  '8453': {
    registryControl: {
      owner: '0xe8259842e71f4E44F2F68D6bfbC15EDA56E63064',
      feeRecipient: '',
    },
    registries: {
      roleRegistry: '0xE1eC57C8EE970280f237863910B606059e9641C9',
      versionRegistry: '',
      assetPluginRegistry: '',
      daoFeeRegistry: '',
    },
  },
}

registryConfig['31337'] = registryConfig['1']
