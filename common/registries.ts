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
      feeRecipient: '0xcBCa96091f43C024730a020E57515A18b5dC633B',
    },
    registries: {
      roleRegistry: '0xE1eC57C8EE970280f237863910B606059e9641C9',
      versionRegistry: '0x1895b15B3d0a70962be86Af0E337018aD63464e0',
      assetPluginRegistry: '0xA9145A22537B39b04fe91AA479c1b8e7a3569c98',
      daoFeeRegistry: '0xec716deD4eABa060937D1a915F166E237039342B',
      trustedFillerRegistry: '0x279ccF56441fC74f1aAC39E7faC165Dec5A88B3A',
    },
  },
  '8453': {
    registryControl: {
      owner: '0xe8259842e71f4E44F2F68D6bfbC15EDA56E63064',
      feeRecipient: '0xcBCa96091f43C024730a020E57515A18b5dC633B',
    },
    registries: {
      roleRegistry: '0xE1eC57C8EE970280f237863910B606059e9641C9',
      versionRegistry: '0xBbC532A80DD141449330c1232C953Da6801Aed01',
      assetPluginRegistry: '0x3312507BC3F22430B34D5841A472c767DC5C36e4',
      daoFeeRegistry: '0x3513D2c7D2F51c678889CeC083E7D7Ae27b219aD',
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
