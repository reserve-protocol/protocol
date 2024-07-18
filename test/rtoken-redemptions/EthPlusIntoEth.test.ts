import { loadFixture, setBalance, setCode } from '@nomicfoundation/hardhat-network-helpers'
import { EthPlusIntoEth } from '@typechain/EthPlusIntoEth'
import { IERC20 } from '@typechain/IERC20'
import { formatEther, parseEther } from 'ethers/lib/utils'
import hardhat, { ethers } from 'hardhat'
import { whileImpersonating } from '../utils/impersonation'
import { forkRpcs, Network } from '#/utils/fork'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
const ETH_PLUS_WHALE = '0xc5C75cAF067Ae899a7EC10b86b5aB38C13879388'

const loader = async () => {
  await hardhat.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: forkRpcs[useEnv('FORK_NETWORK', 'mainnet') as Network],
          blockNumber: 20334000,
        },
      },
    ],
  })

  await hardhat.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [ETH_PLUS_WHALE],
  })
  const signer = await ethers.getSigner(ETH_PLUS_WHALE)
  await setBalance(ETH_PLUS_WHALE, parseEther('10000.0'))
  const ethPlusToETH = await (await ethers.deployContract('EthPlusIntoEth', signer)).deployed()

  const reth = await ethers.getContractAt(
    'IERC20Metadata',
    '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8',
    signer
  )
  await (await reth.approve(ethPlusToETH.address, ethers.utils.parseEther('10000'))).wait(0)

  return { ethPlusToETH, reth, signer }
}
const runTestScenario = async (
  body: (state: {
    signer: SignerWithAddress
    ethPlusToETH: EthPlusIntoEth
    reth: IERC20
  }) => Promise<void>
) => {
  const { ethPlusToETH, reth, signer } = await loadFixture(loader)

  await body({
    ethPlusToETH: ethPlusToETH as EthPlusIntoEth,
    signer,
    reth,
  })
}

describe('EthPlusIntoEth', () => {
  it('swapExactTokensForETH and getAmountsOut are consistent (enough)', async () => {
    await runTestScenario(async ({ ethPlusToETH }) => {
      const simuOutput = await ethPlusToETH.callStatic.getAmountsOut(
        ethers.utils.parseEther('1'),
        [],
        {
          gasLimit: 10_000_000n,
        }
      )
      expect(parseFloat(formatEther(simuOutput[1]))).to.be.gt(1.017)

      const ethBalBefore = await ethers.provider.getBalance(ETH_PLUS_WHALE)

      await ethPlusToETH.swapExactTokensForETH(
        ethers.utils.parseEther('1'),
        0,
        [],
        ETH_PLUS_WHALE,
        0xffffffffffffffffn
      )

      const ethBalAfter = await ethers.provider.getBalance(ETH_PLUS_WHALE)
      expect(ethBalAfter).to.be.gt(ethBalBefore)
    })
  })

  it('Handles 1000 RETH', async () => {
    await runTestScenario(async ({ ethPlusToETH }) => {
      const ethBalBefore = await ethers.provider.getBalance(ETH_PLUS_WHALE)

      await ethPlusToETH.swapExactTokensForETH(
        ethers.utils.parseEther('1000'),
        0,
        [],
        ETH_PLUS_WHALE,
        0xffffffffffffffffn
      )

      const ethBalAfter = await ethers.provider.getBalance(ETH_PLUS_WHALE)
      expect(parseFloat(formatEther(ethBalAfter.sub(ethBalBefore)))).to.be.gt(1017.67)
    })
  })

  it('Handles 2000 RETH', async () => {
    await runTestScenario(async ({ ethPlusToETH }) => {
      const ethBalBefore = await ethers.provider.getBalance(ETH_PLUS_WHALE)
      await ethPlusToETH.swapExactTokensForETH(
        ethers.utils.parseEther('2000'),
        0,
        [],
        ETH_PLUS_WHALE,
        0xffffffffffffffffn
      )

      const ethBalAfter = await ethers.provider.getBalance(ETH_PLUS_WHALE)

      expect(parseFloat(formatEther(ethBalAfter.sub(ethBalBefore)))).to.be.gt(2035.25)
    })
  })

  it('Handles 3000 RETH', async () => {
    await runTestScenario(async ({ ethPlusToETH }) => {
      const ethBalBefore = await ethers.provider.getBalance(ETH_PLUS_WHALE)
      await ethPlusToETH.swapExactTokensForETH(
        ethers.utils.parseEther('3000'),
        0,
        [],
        ETH_PLUS_WHALE,
        0xffffffffffffffffn
      )

      const ethBalAfter = await ethers.provider.getBalance(ETH_PLUS_WHALE)

      expect(parseFloat(formatEther(ethBalAfter.sub(ethBalBefore)))).to.be.gt(3052)
    })
  })
})
