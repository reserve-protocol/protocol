interface IRegistries {
  roleRegistry: string
  versionRegistry: string
  assetPluginRegistry: string
  daoFeeRegistry: string
  trustedFillerRegistry: string
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
      trustedFillerRegistry: '0x279ccF56441fC74f1aAC39E7faC165Dec5A88B3A',
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
      trustedFillerRegistry: '0x72DB5f49D0599C314E2f2FEDf6Fe33E1bA6C7A18',
    },
  },
  '56': {
    registryControl: {
      owner: '0xe8259842e71f4E44F2F68D6bfbC15EDA56E63064',
      feeRecipient: '',
    },
    registries: {
      roleRegistry: '0xE1eC57C8EE970280f237863910B606059e9641C9',
      versionRegistry: '',
      assetPluginRegistry: '',
      daoFeeRegistry: '',
      trustedFillerRegistry: '0x08424d7C52bf9edd4070701591Ea3FE6dca6449B',
    },
  },
}

registryConfig['31337'] = registryConfig['1']
