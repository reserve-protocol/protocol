import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import collateralTests from '../collateralTests'
import { ETH_USD_PRICE_FEED } from './constants'
import {
  CollateralType,
  defaultStargateCollateralOpts,
  stableOpts,
  StargateCollateralOpts,
} from './StargateUSDCTestSuite.test'

export const defaultVolatileStargateCollateralOpts: StargateCollateralOpts = {
  ...defaultStargateCollateralOpts,
  chainlinkFeed: ETH_USD_PRICE_FEED,
}

const volatileOpts = {
  ...stableOpts,
  collateralName: 'Stargate ETH Pool',
  makeCollateralFixtureContext: (alice: SignerWithAddress, opts: StargateCollateralOpts) =>
    stableOpts.makeCollateralFixtureContext(alice, {
      ...defaultVolatileStargateCollateralOpts,
      ...opts,
    }),
  deployCollateral: (opts?: StargateCollateralOpts) =>
    stableOpts.deployCollateral({ ...opts, type: CollateralType.VOLATILE }),
}

collateralTests(volatileOpts)
