import { BigNumber, providers } from 'ethers'
import { formatEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { bn, fp } from '#/common/numbers'
import { networkConfig } from '#/common/configuration'
import { oracleTimeout } from './deployment/utils'
import fs from 'fs'
import { backTestPlugin } from './backtester/backtester'

const htmlReportTemplate = fs.readFileSync("./scripts/backtester/report-template.html", "utf8")

export const main = async () => {
  const provider = new providers.JsonRpcProvider(process.env.MAINNET_RPC_URL)
  const cTokenContractFactory = await ethers.getContractFactory('CTokenFiatCollateral')
  const currentBlock = await provider.getBlockNumber()
  const stride = parseInt(process.env.STRIDE ?? '300', 10)
  const numberOfSamples = parseInt(process.env.SAMPLES ?? '1000', 10)
  if (process.env.BACKTEST_RESULT_DIR != null) {
    console.log('Will save results to ', process.env.BACKTEST_RESULT_DIR)
    if (!fs.existsSync(process.env.BACKTEST_RESULT_DIR)) {
      fs.mkdirSync(process.env.BACKTEST_RESULT_DIR)
    }
  }

  const start = currentBlock - stride * numberOfSamples

  const createCTokenParamSet = (revenueHiding: BigNumber) => ({
    variantName: `CTokenFiatCollateral(revenueHiding=${formatEther(revenueHiding)})`,
    config: {
      priceTimeout: bn('604800').toString(), // 1 week
      chainlinkFeed: networkConfig[1].chainlinkFeeds.USDC!,
      oracleError: fp('0.0025').toString(), // 0.25%
      erc20: networkConfig[1].tokens.cUSDC!,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout('1', '86400').toString(), // 24 hr
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    additionalArgs: {
      revenueHiding: revenueHiding.toString(),
      comptroller: networkConfig[1].COMPTROLLER!,
    },
  })

  // Using the create param set, we can set up a set of backtest variants we want to try
  console.log('Running cToken backtests')
  const cTokenBackTests = await backTestPlugin(
    [
      createCTokenParamSet(fp('0')),
      createCTokenParamSet(fp('1e-6')),
      createCTokenParamSet(fp('1e-5')),
    ],
    async ({ config, additionalArgs }) => {
      const out = cTokenContractFactory.getDeployTransaction(
        config,
        additionalArgs.revenueHiding,
        additionalArgs.comptroller
      ).data!
      return out
    },
    {
      start,
      stride,
      numberOfSamples,
      backtestServiceUrl: process.env.BACKTEST_SERVICE_URL!,
    }
  )

  const backTests = [...cTokenBackTests]

  if (process.env.BACKTEST_RESULT_DIR != null) {
    console.log('Backtest done, saving results')
    const overview: any = {}
    for (const backTest of backTests) {
      console.log(`Saving to ${process.env.BACKTEST_RESULT_DIR}/${backTest.backtestName}.json`)
      fs.writeFileSync(
        `${process.env.BACKTEST_RESULT_DIR}/${backTest.backtestName}.json`,
        JSON.stringify(backTest, null, 2)
      )
      overview[backTest.backtestName] = backTest.result?.pluginStatus ?? 'NO_RESULT'
    }
    fs.writeFileSync(
      `${process.env.BACKTEST_RESULT_DIR}/overview.json`,
      JSON.stringify(overview, null, 2)
    )
    const htmlReport = htmlReportTemplate.replace("const data = []", "const data = " + JSON.stringify(backTests, null, 2))
    fs.writeFileSync(
      `${process.env.BACKTEST_RESULT_DIR}/report.html`,
      htmlReport
    )
  } else {
    const result = {
      date: new Date().toISOString(),
      backTests,
    }
    console.log(JSON.stringify(result, null, 2))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
