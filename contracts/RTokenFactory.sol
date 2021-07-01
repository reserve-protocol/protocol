// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./interfaces/IConfiguration.sol";
import "./zeppelin/governance/TimelockController.sol";
import "./modules/SimpleOrderbookExchange.sol";
import "./modules/InsurancePool.sol";
import "./modules/Configuration.sol";
import "./RToken.sol";

/*
 * @title ReserveProtocolV1
 * @dev Static deployment of V1 of the Reserve Protocol. 
 * Allows anyone to create insured basket currencies that have the ability to change collateral. 
 */
contract ReserveProtocolV1 {

    address public immutable exchangeAddress;

    constructor () {
        exchangeAddress = address(new SimpleOrderbookExchange());
    }

    function deploy(
        bool timelockGovernance,
        address owner,
        string calldata name, 
        string calldata symbol,
        Token[] memory tokens,
        Token memory insuranceToken,
        ConfigurationParams memory configParams
    ) public returns (
        address rToken, 
        address insurancePool, 
        address configuration, 
        address timelockController
    ) {
        // Deploy static configuration
        Configuration c = new Configuration(
            tokens,
            insuranceToken,
            configParams
        );

        address govAddress = owner;
        if (timelockGovernance) {
            // Launch TimelockController with initial delay of 0s
            address[] memory controllers = new address[](1);
            controllers[0] = owner;
            TimelockController tc = new TimelockController(0, controllers, controllers);
            govAddress = address(tc);
        }

        // Create RToken and InsurancePool
        RToken rtoken = new RToken(govAddress, name, symbol, address(c));
        (address rsrAddress,,,,) = c.insuranceToken();   
        InsurancePool ip = new InsurancePool(address(rtoken), rsrAddress);
        return (address(rtoken), address(ip), address(c), govAddress);
    }
}
