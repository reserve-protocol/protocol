import { BytesLike } from 'ethers/lib/utils'
import fetch from 'isomorphic-fetch'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface SubmitBacktestJobRequest {
  stride: number
  startBlock: number
  samples: number
  config: any
  byteCode: string,
  erc20Wrapper?: {
    byteCode: string,
    calls: { data: string }[]
  } | null | undefined,
  variants: { name: string, args: string }[]
}

export const submitBacktest = async (
  backtestServiceUrl: string,
  req: SubmitBacktestJobRequest,
) => {
  const resp = await fetch(`${backtestServiceUrl}/api/backtest-plugin`, {
    method: 'POST',
    body: JSON.stringify(req),
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
  backtestServiceUrl: string,
  request: SubmitBacktestJobRequest
) => {
  try {
    const backtestJob = await submitBacktest(
      backtestServiceUrl,
      request
    )

    const backtestJobResult = await awaitBacktestJobResult(
      backtestServiceUrl,
      backtestJob.hash
    )

    return {
      status: backtestJobResult.jobStatus,
      result: backtestJobResult,
    }
  } catch (e: any) {
    console.error(e)
    return {
      status: 'FAILED',
      error: e.toString(),
    }
  }
}
