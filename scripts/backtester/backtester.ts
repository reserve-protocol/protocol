import { BytesLike } from 'ethers/lib/utils'
import fetch from 'isomorphic-fetch'

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

export const backTestPlugin = async (
  deployTransactions: BytesLike[],
  opts: {
    start: number
    stride: number
    numberOfSamples: number
    backtestServiceUrl: string
  }
) => {
  return await Promise.all(
    deployTransactions.map(async (deployTx) => {
      try {
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
          result: backtestJobResult,
        }
      } catch (e: any) {
        console.log('Skking')
        return {
          status: 'FAILED',
          error: e.toString(),
        }
      }
    })
  )
}
