pragma solidity 0.8.4;

import './interfaces/IRTokenV1Deployer.sol';
import "./rtoken/Configuration.sol";
import "./rtoken/InsurancePool.sol";
import "./rtoken/RToken.sol";


contract ReserveProtocolV1 {
    function deploy(
        string calldata _name, 
        string calldata _symbol, 
        Configuration.CollateralToken[] calldata _basket, 
        Configuration.Parameters calldata _params
    ) public returns (address rToken, address insurancePool, address configuration) {
        Configuration c = new Configuration(_basket, _params);
        RToken r = new RToken(_name, _symbol, c);
        InsurancePool ip = new InsurancePool(address(r), c.params.rsrTokenAddress);
        return (address(r), address(ip), address(c));
    }
}
