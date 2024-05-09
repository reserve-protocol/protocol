import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { forkRpcs, Network } from '#/utils/fork'
import { useEnv } from '#/utils/env'

export const resetFork = async (hre: HardhatRuntimeEnvironment, forkBlock: number) => {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: forkRpcs[useEnv('FORK_NETWORK', 'mainnet') as Network],
          blockNumber: forkBlock,
        },
      },
    ],
  })
}
