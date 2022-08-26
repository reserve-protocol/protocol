import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'

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
      'EURT',
      'RSR',
    ]

    for (const token of tokens) {
      const networkTokens = networkConfig[chainId].tokens
      const addr = networkTokens[token as keyof typeof networkTokens]
      const tok = await hre.ethers.getContractAt('ERC20Mock', addr as string)
      const decimals = await tok.decimals()
      const amt = hre.ethers.BigNumber.from('10').pow(decimals + 9)
      console.log(`Minting ${amt} of ${token}`)
      await tok.connect(deployer).mint(params.address, amt.toString())

      // Sleep 0.5s
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!params.noOutput) {
      console.log(
        `Minted the tokens we've mocked on ${hre.network.name} (${chainId}) to account ${params.address}`
      )
    }
  })
