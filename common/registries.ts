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
      versionRegistry: '0x37c8646139Cf69863cA8C6F09BE09300d4Dc10bf',
      assetPluginRegistry: '0x6cf05Ea2A94a101CE6A44Ec2a2995b43F1b0958f',
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
      versionRegistry: '0x35E6756B92daf6aE2CF2156d479e8a806898971B',
      assetPluginRegistry: '0x87A959e0377C68A50b08a91ae5ab3aFA7F41ACA4',
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
