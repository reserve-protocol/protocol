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
        string calldata _name, 
        string calldata _symbol, 
        IConfiguration.CollateralToken[] calldata _basket, 
        IConfiguration.Parameters calldata _params
    ) public returns (address rToken, address insurancePool, address configuration) {
        Configuration c = new Configuration(_basket, _params);
        RToken r = new RToken(_name, _symbol, c);
        InsurancePool ip = new InsurancePool(address(r), c.params.rsrTokenAddress);
        return (address(r), address(ip), address(c));
    }
}
