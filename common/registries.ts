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
}

registryConfig['31337'] = registryConfig['1']
