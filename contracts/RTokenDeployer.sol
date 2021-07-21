// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./interfaces/IRTokenDeployer.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IInsurancePool.sol";
import "./modules/InsurancePool.sol";
import "./libraries/Token.sol";
import "./RToken.sol";

/*
 * @title RTokenDeployer
 * @dev Static deployment of V1 of the Reserve Protocol.
 * Allows anyone to create insured basket currencies that have the ability to change collateral.
 */
contract RTokenDeployer is IRTokenDeployer {
    // Implementation addresses to be used for proxy deployments
    IRToken public immutable rTokenImplementation;
    IInsurancePool public immutable insurancePoolImplementation;

    // Register tokens created by factory
    mapping(address => bool) public isRToken;

    constructor(IRToken rTokenImplementation_, IInsurancePool insurancePoolImplementation_) {
        rTokenImplementation = rTokenImplementation_;
        insurancePoolImplementation = insurancePoolImplementation_;
    }

    function deploy(
        address owner,
        string calldata name,
        string calldata symbol,
        RToken.Config memory rTokenConfig,
        Token.Info[] memory basketTokens,
        Token.Info memory rsrToken
    ) external override returns (address rToken) {
        // Perform validations on parameters
        require(owner != address(0));
        require(basketTokens.length > 0);

        // Deploy Proxy for RToken
        rToken = address(
            new ERC1967Proxy(
                address(rTokenImplementation),
                abi.encodeWithSelector(
                    RToken(address(0)).initialize.selector,
                    name,
                    symbol,
                    rTokenConfig,
                    basketTokens,
                    rsrToken
                )
            )
        );

        // Deploy Proxy for InsurancePool
        address ipool = address(
            new ERC1967Proxy(
                address(insurancePoolImplementation),
                abi.encodeWithSelector(
                    InsurancePool(address(0)).initialize.selector,
                    rToken,
                    rsrToken.tokenAddress
                )
            )
        );

        // Set insurance Pool address in RToken
        rTokenConfig.insurancePool = InsurancePool(ipool);
        RToken(rToken).updateConfig(rTokenConfig);

        // Transfer ownerships
        RToken(rToken).transferOwnership(owner);
        InsurancePool(ipool).transferOwnership(owner);

        // Register token
        isRToken[rToken] = true;
        emit RTokenDeployed(rToken);
    }
}
