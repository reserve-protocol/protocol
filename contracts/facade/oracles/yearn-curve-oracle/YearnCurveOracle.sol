// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { FIX_ONE, divuu } from "../../../libraries/Fixed.sol";

/**
 * @title YearnCurveOracle
 * @notice An immutable Exchange Rate Oracle for a Yearn Vault containing a Curve LP Token,
 *         with one or more appreciating assets. Only for 2-asset Curve LP Tokens.
 *
 * ::Warning:: When pairing with an RToken, same assumptions apply as in `ExchangeRateOracle`.
 */
contract YearnCurveOracle {

}
