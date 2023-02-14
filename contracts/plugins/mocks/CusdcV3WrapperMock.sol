// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "contracts/plugins/assets/compound/CusdcV3Wrapper.sol";
import "contracts/plugins/assets/compound/ICusdcV3Wrapper.sol";

interface ICusdcV3WrapperMock is ICusdcV3Wrapper {
    function setMockExchangeRate(bool setMock, uint256 mockValue) external;
}

contract CusdcV3WrapperMock {
    address internal mockTarget;
    mapping(bytes4 => bool) internal isMocking;
    uint256 internal mockExchangeRate_;

    constructor(address mockTarget_) {
        mockTarget = mockTarget_;
    }

    function setMockExchangeRate(bool setMock, uint256 mockValue) external {
        isMocking[this.exchangeRate.selector] = setMock;
        mockExchangeRate_ = mockValue;
    }

    function exchangeRate() public view returns (uint256) {
        if (isMocking[this.exchangeRate.selector]) {
            return mockExchangeRate_;
        } else {
            return CusdcV3Wrapper(mockTarget).exchangeRate();
        }
    }

    fallback() external payable {
        address target = mockTarget;
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
}
