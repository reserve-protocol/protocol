// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/interfaces/IClaimAdapter.sol";

/// Claim adapter for the Compound protocol
contract CompoundClaimAdapterP0 is IClaimAdapter {
    IComptroller public immutable comptroller;

    IERC20 public immutable rewardERC20;

    constructor(IComptroller comptroller_, IERC20 rewardERC20_) {
        comptroller = comptroller_;
        rewardERC20 = rewardERC20_;
    }

    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata(IERC20) external view returns (address _to, bytes memory _calldata) {
        _to = address(comptroller);
        _calldata = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
