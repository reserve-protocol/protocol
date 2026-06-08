import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig, ITokens } from '../../../../common/configuration'
import { fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import {
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDC_USD_FEED,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  USDT_USD_FEED,
  PYUSD_ORACLE_TIMEOUT,
  PYUSD_ORACLE_ERROR,
  PYUSD_USD_FEED,
  PRICE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../../test/plugins/individual-collateral/meta-morpho/constants'
import { MetaMorphoFiatCollateral } from '../../../../typechain'
import { ContractFactory, BigNumber } from 'ethers'

// Morpho Vault V2 collaterals. All are USD-pegged MetaMorpho ERC4626 vaults with
// no gates and 18-decimal shares over a 6-decimal asset (verified on-chain).
interface V2VaultDeployment {
  tokenKey: keyof ITokens
  feed: string
  oracleTimeout: BigNumber
  oracleError: BigNumber
}

const VAULTS: V2VaultDeployment[] = [
  {
    tokenKey: 'steakUSDCPrime',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'sentoraPYUSD',
    feed: PYUSD_USD_FEED,
    oracleTimeout: PYUSD_ORACLE_TIMEOUT,
    oracleError: PYUSD_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'gauntletUSDCFrontier',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'steakUSDTPrime',
    feed: USDT_USD_FEED,
    oracleTimeout: USDT_ORACLE_TIMEOUT,
    oracleError: USDT_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'galaxyUSDTQuality',
    feed: USDT_USD_FEED,
    oracleTimeout: USDT_ORACLE_TIMEOUT,
    oracleError: USDT_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'gauntletUSDCPrime',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'galaxyUSDCQuality',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'skyUSDTSavings',
    feed: USDT_USD_FEED,
    oracleTimeout: USDT_ORACLE_TIMEOUT,
    oracleError: USDT_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
]

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Morpho Vault V2 collaterals to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedCollateral: string[] = []

  const MetaMorphoFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'MetaMorphoFiatCollateral'
  )

  for (const v of VAULTS) {
    const erc20 = networkConfig[chainId].tokens[v.tokenKey]
    if (!erc20) {
      throw new Error(`Missing token address for ${v.tokenKey} on chain ${chainId}`)
    }

    const collateral = <MetaMorphoFiatCollateral>await MetaMorphoFiatCollateralFactory.connect(
      deployer
    ).deploy(
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: v.feed,
        oracleError: v.oracleError.toString(),
        erc20: erc20,
        maxTradeVolume: fp('1e6').toString(),
        oracleTimeout: v.oracleTimeout.toString(),
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: v.oracleError.add(fp('0.01')).toString(), // +1% buffer rule
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      },
      fp('1e-4') // can have mild drawdowns
    )
    await collateral.deployed()

    console.log(`Deployed ${v.tokenKey} to ${hre.network.name} (${chainId}): ${collateral.address}`)
    await (await collateral.refresh({ gasLimit: 3_000_000 })).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral[v.tokenKey] = collateral.address
    assetCollDeployments.erc20s[v.tokenKey] = erc20
    deployedCollateral.push(collateral.address.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  console.log(`Deployed Morpho Vault V2 collaterals to ${hre.network.name} (${chainId})
        New deployments: ${deployedCollateral}
        Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
