import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../scripts/deployment/common'
import { whileImpersonating } from '#/utils/impersonation'
import { fp } from '#/common/numbers'

task('mint-tokens', 'Mints all the tokens to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    if (!params.noOutput) {
      console.log(
        `Minting the tokens we've mocked on ${hre.network.name} (${chainId}) to account ${params.address}...`
      )
    }

    const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
    const assetCollDeployments = <IAssetCollDeployments>(
      getDeploymentFile(assetCollDeploymentFilename)
    )

    const tokens = [
      'DAI',
      'USDC',
      'USDT',
      'BUSD',
      'USDP',
      'TUSD',
      'aDAI',
      'aUSDC',
      'aUSDT',
      'aBUSD',
      'cDAI',
      'cUSDC',
      'cETH',
      'cWBTC',
      'AAVE',
      'stkAAVE',
      'COMP',
      'WETH',
      'WBTC',
      'RSR',
    ]

    for (const token of tokens) {
      const networkTokens = networkConfig[chainId].tokens
      const addr = networkTokens[token as keyof typeof networkTokens]
      const tok = await hre.ethers.getContractAt('ERC20Mock', addr as string)
      const decimals = await tok.decimals()
      const amt = hre.ethers.BigNumber.from('10').pow(decimals + 9)
      console.log(`Minting ${amt} of ${token}`)

      // For ATokens, mint staticAToken balances
      if (token.indexOf('a') == 0) {
        await (await tok.connect(deployer).mint(deployer.address, amt.toString())).wait()

        const collateral = assetCollDeployments.collateral
        const collAddr = collateral[token as keyof typeof collateral] as string
        const coll = await hre.ethers.getContractAt('IAsset', collAddr)
        const staticAToken = await hre.ethers.getContractAt('StaticATokenLM', await coll.erc20())

        console.log(`Approving a ${amt} ${token} deposit`)
        await (await tok.connect(deployer).approve(staticAToken.address, amt.toString())).wait()

        console.log(`Depositing into ${await staticAToken.symbol()} at address ${collAddr}`)
        await (
          await staticAToken.connect(deployer).deposit(deployer.address, amt.toString(), 0, false)
        ).wait()

        await staticAToken.transfer(params.address, amt.toString()) // don't need to wait
      } else {
        await tok.connect(deployer).mint(params.address, amt.toString()) // don't need to wait
      }

      // Sleep 0.5s
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!params.noOutput) {
      console.log(
        `Minted the tokens we've mocked on ${hre.network.name} (${chainId}) to account ${params.address}`
      )
    }
  })

task('give-rsr', 'Mints RSR to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .addOptionalParam('amount', 'Amount of RSR to mint', fp('1e9').toString(), types.string)
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    const rsr = await hre.ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.RSR!)
    const rsrWhale =
      chainId == '8453'
        ? '0x95F04B5594e2a944CA91d56933D119841eeF9a99'
        : '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'
    await whileImpersonating(hre, rsrWhale, async (signer) => {
      await rsr.connect(signer).transfer(params.address, params.amount)
    })

    console.log(`${params.amount} RSR sent to ${params.address}`)
  })
