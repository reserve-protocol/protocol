// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IPausable {
    /// Emitted when the paused status is set
    /// @param oldPaused The old value of the paused state
    /// @param newPaused The new value of the paused state
    event PausedSet(bool oldPaused, bool newPaused);

    /// Emitted when the pauser address is set
    /// @param oldPauser The address of the old pauser
    /// @param newPauser The address of the new pauser
    event PauserSet(address oldPauser, address newPauser);

    function pause() external;

    function unpause() external;

    function paused() external returns (bool);

    function pauser() external view returns (address);

    function setPauser(address pauser_) external;
}
