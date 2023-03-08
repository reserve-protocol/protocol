tmux new -d
tmux send 'bash ~/protocol/scripts/exhaustive-tests/run-1.sh |& tee tmux-1.log'
tmux send ENTER
tmux new -d
tmux send 'bash ~/protocol/scripts/exhaustive-tests/run-2.sh |& tee tmux-2.log'
tmux send ENTER