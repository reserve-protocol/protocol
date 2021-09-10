// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./interfaces/IRTokenDeployer.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IInsurancePool.sol";
import "./modules/InsurancePool.sol";
import "./libraries/Token.sol";
import "./RToken.sol";
import "./helpers/ErrorMessages.sol";

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

    /// Deploys a new RToken.
    function deploy(
        address owner,
        string calldata name,
        string calldata symbol,
        RToken.Config memory rTokenConfig,
        Token.Info[] memory basketTokens,
        Token.Info memory rsrToken
    ) external override returns (address rToken) {
        if (owner == address(0)) {
            revert OwnerNotDefined();
        }
        if (basketTokens.length == 0) {
            revert EmptyBasket();
        }

        // Deploy RToken Proxy and connect it to the RToken implementation.
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

        // Deploy InsurancePool Proxy and connect it to the InsurancePool implementation.
        address ipool = address(
            new ERC1967Proxy(
                address(insurancePoolImplementation),
                abi.encodeWithSelector(InsurancePool(address(0)).initialize.selector, rToken, rsrToken.tokenAddress)
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
