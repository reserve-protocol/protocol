// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IOracle.sol";

contract OracleMockP0 is IOracle {
    uint256 constant padding = 10**12;

    mapping(address => uint256) public prices;

    constructor(ICollateral[] memory collaterals, uint256 initialPrice) {
        for (uint256 i = 0; i < collaterals.length; i++) {
            setPrice(collaterals[i].fiatcoin(), initialPrice);
        }
    }

    // Returns the USD price using 18 decimals
    function fiatcoinPrice(ICollateral collateral) external view override returns (uint256) {
        if (keccak256(bytes(collateral.oracle())) == keccak256("AAVE")) {
            return consultAave(collateral.fiatcoin());
        } else if (keccak256(bytes(collateral.oracle())) == keccak256("COMP")) {
            return consultCompound(collateral.fiatcoin());
        }
        assert(false);
        return 0;
    }

    // Returns the USD price using 18 decimals
    function consultAave(address token) public view override returns (uint256) {
        return prices[token];
    }

    // Returns the USD price using 18 decimals
    function consultCompound(address token) public view override returns (uint256) {
        return prices[token];
    }

    function setPrice(address token, uint256 amount) public {
        prices[token] = amount;
    }
}
