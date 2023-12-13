import { Signer, constants } from 'ethers'
import { DutchTrade, DutchTradeRouter, IERC20 } from '../../typechain'

export const ensureApproval = async (
  token: IERC20,
  signer: Signer,
  address: string,
  router: DutchTradeRouter
) => {
  const allowance = await token.connect(signer).allowance(address, router.address)
  if (allowance.eq(constants.Zero)) {
    await token.connect(signer).approve(router.address, constants.MaxUint256)
  }
}

export const bidOnTrade = async (
  trade: DutchTrade,
  token: IERC20,
  router: DutchTradeRouter,
  signer: Signer = token.signer
) => {
  const addr = await signer.getAddress()
  await ensureApproval(token, signer, addr, router)
  return router.connect(signer).bid(trade.address, addr)
}
export const bidOnTradeStatic = async (
  trade: DutchTrade,
  token: IERC20,
  router: DutchTradeRouter,
  signer: Signer = token.signer
) => {
  const addr = await signer.getAddress()
  await ensureApproval(token, signer, addr, router)
  const out = await router.connect(signer).callStatic.bid(trade.address, addr)
  return out
}
