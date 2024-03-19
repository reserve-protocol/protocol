// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/compoundv3/CusdcV3Wrapper.sol";
import "../assets/compoundv3/ICusdcV3Wrapper.sol";

interface ICusdcV3WrapperMock is ICusdcV3Wrapper {
    function setMockExchangeRate(bool setMock, uint256 mockValue) external;
}

contract CusdcV3WrapperMock {
    uint256[20] private __gap;
    address internal mockTarget;
    mapping(bytes4 => bool) internal isMocking;
    uint256 internal mockExchangeRate_;
    bool internal revertExchangeRate;

    constructor(address mockTarget_) {
        mockTarget = mockTarget_;
    }

    function setMockExchangeRate(bool setMock, uint256 mockValue) external {
        isMocking[this.exchangeRate.selector] = setMock;
        mockExchangeRate_ = mockValue;
    }

    function setRevertExchangeRate(bool shouldRevert) external {
        revertExchangeRate = shouldRevert;
    }

    function exchangeRate() public view returns (uint256) {
        if (revertExchangeRate) revert("exchangeRate revert");
        if (isMocking[this.exchangeRate.selector]) {
            return mockExchangeRate_;
        } else {
            return CusdcV3Wrapper(mockTarget).exchangeRate();
        }
    }

    // solhint-disable-next-line no-complex-fallback
    fallback() external payable {
        address target = mockTarget;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {
        revert("don't send me eth");
    }
}
