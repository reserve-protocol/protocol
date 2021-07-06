// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/governance/TimelockController.sol";

import "./interfaces/IConfiguration.sol";
import "./modules/InsurancePool.sol";
import "./modules/Configuration.sol";
import "./modules/Owner.sol";
import "./RToken.sol";

/*
 * @title RTokenDeployer
 * @dev Static deployment of V1 of the Reserve Protocol.
 * Allows anyone to create insured basket currencies that have the ability to change collateral.
 */
contract RTokenDeployer {
    function deploy(
        address owner,
        string calldata name,
        string calldata symbol,
        Token[] memory tokens,
        Token memory insuranceToken,
        ConfigurationParams memory configParams
    )
        public
        returns (
            address rToken,
            address insurancePool,
            address configuration
        )
    {
        // Deploy static configuration
        Configuration c = new Configuration(tokens, insuranceToken, configParams);

        // Create RToken and InsurancePool
        RToken rtoken = new RToken(owner, name, symbol, address(c));
        InsurancePool ip = new InsurancePool(address(rtoken), c.insuranceTokenAddress());
        return (address(rtoken), address(ip), address(c));
    }
}
