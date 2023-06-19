import { BigNumber, providers } from 'ethers'
import { BytesLike, formatEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { bn, fp } from '#/common/numbers'
import { networkConfig } from '#/common/configuration'
import { oracleTimeout } from './deployment/utils'
import fetch from 'isomorphic-fetch'
import fs from 'fs'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const submitBacktest = async (
  backtestServiceUrl: string,
  deploymentTransactionData: BytesLike,
  start: number,
  stride: number,
  numberOfSamples: number
) => {
  const resp = await fetch(`${backtestServiceUrl}/api/backtest-plugin`, {
    method: 'POST',
    body: JSON.stringify({
      byteCode: deploymentTransactionData,
      stride,
      startBlock: start,
      samples: numberOfSamples,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  })
  let result: any = await resp.json()

  return result
}

export const awaitBacktestJobResult = async (backtestServiceUrl: string, key: string) => {
  let result: any
  while (1) {
    await sleep(2000)
    result = await (
      await fetch(`${backtestServiceUrl}/api/backtest-plugin-status/${key}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    ).json()

    if (result.jobStatus !== 'RUNNING') {
      return await (
        await fetch(`${backtestServiceUrl}/api/backtest-plugin/${key}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      ).json()
    }
  }
}

const backTestPlugin = async <TT, T>(
  parametersToTest: { variantName: string; config: TT; additionalArgs: T }[],
  createDeployTx: (testParams: { config: TT; additionalArgs: T }) => Promise<BytesLike>,
  opts: {
    start: number
    stride: number
    numberOfSamples: number
    backtestServiceUrl: string
  }
) => {
  return await Promise.all(
    parametersToTest.map(async (params) => {
      try {
        const deployTx = await createDeployTx(params)
        const backtestJob = await submitBacktest(
          opts.backtestServiceUrl,
          deployTx,
          opts.start,
          opts.stride,
          opts.numberOfSamples
        )

        const backtestJobResult = await awaitBacktestJobResult(
          opts.backtestServiceUrl,
          backtestJob.hash
        )

        return {
          status: backtestJobResult.jobStatus,
          backtestName: params.variantName,
          constructorArgs: {
            config: params.config,
            additionalArgs: params.additionalArgs,
          },
          result: backtestJobResult,
        }
      } catch (e: any) {
        console.error(`Failed to ${e} run backtest for ${params.variantName}`)
        console.log('Skking')
        return {
          status: 'FAILED',
          backtestName: params.variantName,
          constructorArgs: {
            config: params.config,
            additionalArgs: params.additionalArgs,
          },
          error: e.toString(),
        }
      }
    })
  )
}

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
