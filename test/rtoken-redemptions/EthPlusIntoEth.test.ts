import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { EthPlusIntoEth } from '@typechain/EthPlusIntoEth'
import { IERC20 } from '@typechain/IERC20'
import { formatEther, parseEther } from 'ethers/lib/utils'
import hardhat, { ethers } from 'hardhat'
import { whileImpersonating } from '../utils/impersonation'
import { forkRpcs, Network } from '#/utils/fork'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'

describe('EthPlusIntoEth', () => {
  it('swapExactTokensForETH', async () => {
    await hardhat.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: forkRpcs[useEnv('FORK_NETWORK', 'mainnet') as Network],
            blockNumber: 20190000,
          },
        },
      ],
    })

    await whileImpersonating('0x7cc1bfab73be4e02bb53814d1059a98cf7e49644', async (signer) => {
      await setBalance('0x7cc1bfab73be4e02bb53814d1059a98cf7e49644', parseEther('100'))

      const ethPlusToETH: EthPlusIntoEth = (await ethers.deployContract(
        'EthPlusIntoEth',
        signer
      )) as any

      const reth: IERC20 = await ethers.getContractAt(
        'IERC20Metadata',
        '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8',
        signer
      )
      await reth.approve(ethPlusToETH.address, ethers.utils.parseEther('1'))

      const simuOutput = await ethPlusToETH.callStatic.getAmountsOut(ethers.utils.parseEther('1'), [], {
        gasLimit: 10_000_000n,
      })

      const realOutput = await ethPlusToETH.callStatic.swapExactTokensForETH(
        ethers.utils.parseEther('1'),
        0,
        [],
        '0x7cc1bfab73be4e02bb53814d1059a98cf7e49644',
        Math.floor(Date.now() / 1000) + 10000,
        {
          gasLimit: 10_000_000n,
        }
      )
      
      expect(
        Math.abs(parseFloat(formatEther(simuOutput[1].sub(realOutput[1]))))
      ).to.be.lt(0.00001)
    })
  })
})
