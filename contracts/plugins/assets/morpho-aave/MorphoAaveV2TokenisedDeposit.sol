// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20, IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { IMorpho, IMorphoUsersLens } from "./IMorpho.sol";
import { MorphoTokenisedDeposit, MorphoTokenisedDepositConfig } from "./MorphoTokenisedDeposit.sol";

struct MorphoAaveV2TokenisedDepositConfig {
    IMorpho morphoController;
    IMorphoUsersLens morphoLens;
    IERC20Metadata underlyingERC20;
    IERC20Metadata poolToken;
    ERC20 rewardToken;
}

contract MorphoAaveV2TokenisedDeposit is MorphoTokenisedDeposit {
    IMorphoUsersLens public immutable morphoLens;

    constructor(MorphoAaveV2TokenisedDepositConfig memory config)
        MorphoTokenisedDeposit(
            MorphoTokenisedDepositConfig({
                morphoController: config.morphoController,
                underlyingERC20: config.underlyingERC20,
                poolToken: config.poolToken,
                rewardToken: config.rewardToken
            })
        )
    {
        morphoLens = config.morphoLens;
    }

    function getMorphoPoolBalance(address _poolToken)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        (, , uint256 supplyBalance) = morphoLens.getCurrentSupplyBalanceInOf(
            _poolToken,
            address(this)
        );
        return supplyBalance;
    }
}
