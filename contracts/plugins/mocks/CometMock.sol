// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

// prettier-ignore
contract CometMock {
    int256 internal _reserves;
    address public externalDelegate;

    struct TotalsBasic {
        // 1st slot
        uint64 baseSupplyIndex;
        uint64 baseBorrowIndex;
        uint64 trackingSupplyIndex;
        uint64 trackingBorrowIndex;
        // 2nd slot
        uint104 totalSupplyBase;
        uint104 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
    }

    struct UserBasic {
        int104 principal;
        uint64 baseTrackingIndex;
        uint64 baseTrackingAccrued;
        uint16 assetsIn;
        uint8 _reserved;
    }

    constructor(int256 reserves_, address delegate) {
        _reserves = reserves_;
        externalDelegate = delegate;
    }

    function setReserves(int256 amount) external {
        _reserves = amount;
    }

    function getReserves() public view returns (int256) {
        return _reserves;
    }

    // solhint-disable-next-line no-empty-blocks
    function accrueAccount(address account) public {}

    // solhint-disable-next-line no-complex-fallback
    fallback() external payable {
        address delegate = externalDelegate;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := call(gas(), delegate, 0, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {
        revert("don't send me eth");
    }
}
