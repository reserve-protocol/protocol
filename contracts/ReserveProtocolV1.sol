pragma solidity 0.8.4;

import './interfaces/IRTokenV1Deployer.sol';
import "./interfaces/IConfiguration.sol";
import "./InsurancePool.sol";
import "./RToken.sol";

/*
 * @title ReserveProtocolV1
 * @dev Static deployment of V1 of the Reserve Protocol. 
 * Allows anyone to create insured basket currencies that have the ability to change collateral. 
 */
contract ReserveProtocolV1 {
    function deploy(
        address calldata owner_,
        string calldata name_, 
        string calldata symbol_, 
        IConfiguration.CollateralToken[] calldata basket_, 
        IConfiguration.Parameters calldata params_
    ) public returns (
        address rToken, 
        address insurancePool, 
        address configuration, 
        address timelockController
    ) {
        // Deploy static configuration
        Configuration c = new Configuration(_basket, params_);

        // Launch TimelockController with initial delay of 0s
        address[] memory controllers = [owner_];
        TimelockController tc = new TimelockController(0, controllers, controllers);

        // Create RToken and InsurancePool
        RToken rtoken = new RToken(address(tc), name_, symbol_, c);
        InsurancePool ip = new InsurancePool(address(rtoken), c.params.rsrTokenAddress);
        return (address(rtoken), address(ip), address(c), address(tc));
    }
}
