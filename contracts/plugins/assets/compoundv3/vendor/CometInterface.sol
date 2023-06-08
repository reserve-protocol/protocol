// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import "./CometMainInterface.sol";
import "./CometExtInterface.sol";

/**
 * @title Compound's Comet Interface
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
abstract contract CometInterface is CometMainInterface, CometExtInterface {
    struct UserBasic {
        int104 principal;
        uint64 baseTrackingIndex;
        uint64 baseTrackingAccrued;
    }

    function userBasic(address account) external view virtual returns (UserBasic memory);
}
