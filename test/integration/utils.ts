import axios from 'axios'
import { ContractTransaction } from 'ethers'
import hre from 'hardhat'

export const evmSnapshot = async () => await hre.network.provider.send('evm_snapshot', [])

export const evmRevert = async (id: string) => hre.network.provider.send('evm_revert', [id])

export const waitForTx = async (tx: ContractTransaction) => await tx.wait(1)

type ZeroExSwapParams = {
  sellToken: string
  buyToken: string
  slippagePercentage?: number
} & ({ sellAmount: number | string } | { buyAmount: number | string })

interface ZeroExResponse {
  buyAmount: number
  buyTokenToEthRate: number
  data: string
  gas: number
  gasPrice: number
  guaranteedPrice: number
  price: number
  sellAmount: number
  sellTokenToEthRate: number
  sources: { name: string; proportion: string }[]
  to: string
  value: number
}

export const get0xSwap = async (type: 'price' | 'quote', params: ZeroExSwapParams) => {
  const { data } = await axios.get(`https://api.0x.org/swap/v1/${type}`, { params })
  return data as ZeroExResponse
}

export const buildPermitParams = (
  chainId: number,
  token: string,
  revision: string,
  tokenName: string,
  owner: string,
  spender: string,
  nonce: number,
  deadline: string,
  value: string
) => ({
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit' as const,
  domain: {
    name: tokenName,
    version: revision,
    chainId: chainId,
    verifyingContract: token,
  },
  message: {
    owner,
    spender,
    value,
    nonce,
    deadline,
  },
})

export const buildMetaDepositParams = (
  chainId: number,
  token: string,
  revision: string,
  tokenName: string,
  depositor: string,
  recipient: string,
  referralCode: number,
  fromUnderlying: boolean,
  nonce: number,
  deadline: string,
  value: string
) => ({
  types: {
    Deposit: [
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'fromUnderlying', type: 'bool' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Deposit' as const,
  domain: {
    name: tokenName,
    version: revision,
    chainId: chainId,
    verifyingContract: token,
  },
  message: {
    depositor,
    recipient,
    value,
    referralCode,
    fromUnderlying,
    nonce,
    deadline,
  },
})

export const buildMetaWithdrawParams = (
  chainId: number,
  token: string,
  revision: string,
  tokenName: string,
  owner: string,
  recipient: string,
  staticAmount: string,
  dynamicAmount: string,
  toUnderlying: boolean,
  nonce: number,
  deadline: string
) => ({
  types: {
    Withdraw: [
      { name: 'owner', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'staticAmount', type: 'uint256' },
      { name: 'dynamicAmount', type: 'uint256' },
      { name: 'toUnderlying', type: 'bool' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Withdraw' as const,
  domain: {
    name: tokenName,
    version: revision,
    chainId: chainId,
    verifyingContract: token,
  },
  message: {
    owner,
    recipient,
    staticAmount,
    dynamicAmount,
    toUnderlying,
    nonce,
    deadline,
  },
})
