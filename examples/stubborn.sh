#!/usr/bin/env bash
# Ignores the normal stop signal (SIGHUP) and Ctrl+C on purpose, to test that
# Script Runner's Stop button still ends it with a hard kill after a few seconds.

trap 'echo "  (ignored the stop signal)"' HUP
trap 'echo "  (ignored Ctrl+C)"' INT

echo "Running until killed. Press Stop: it should end about 3 seconds later."
second=0
while true; do
    second=$((second + 1))
    echo "  still alive: ${second}s"
    sleep 1
done
