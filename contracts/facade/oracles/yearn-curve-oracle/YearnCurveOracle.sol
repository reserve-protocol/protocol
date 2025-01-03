// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { CurveOracle } from "../curve-oracle/CurveOracle.sol";

interface YearnVault {
    function pricePerShare() external view returns (uint256);
}

/**
 * @title YearnCurveOracle
 * @notice An immutable Exchange Rate Oracle for a Yearn Vault containing a Curve LP Token,
 *         with one or more appreciating assets. Only for 2-asset Curve LP Tokens.
 */
contract YearnCurveOracle is CurveOracle {
    YearnVault public immutable yearnVault;

    constructor(
        address _yearnVault,
        address _curvePool,
        OracleConfig memory _oracleConfig0,
        OracleConfig memory _oracleConfig1
    ) CurveOracle(_curvePool, _oracleConfig0, _oracleConfig1) {
        yearnVault = YearnVault(_yearnVault);
    }

    function getPrice() public view virtual override returns (uint256) {
        uint256 pricePerShare = yearnVault.pricePerShare();

        return (CurveOracle.getPrice() * pricePerShare) / 1e18;
    }
}
