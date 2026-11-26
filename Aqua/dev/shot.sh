#!/bin/zsh
# usage: dev/shot.sh <model> <t> <az> <polar> <dist> <tx> <ty> <tz> <name> [extra-query]
cd "/Users/konstantin/Documents/Dev/GLM 5.4/Aqua"
m=$1; t=$2; az=$3; polar=$4; dist=$5; tx=$6; ty=$7; tz=$8; name=$9; extra=${10}
playwright-cli -s=aqua goto "http://127.0.0.1:8791/dev/preview.html?m=$m&t=$t&az=$az&polar=$polar&dist=$dist&tx=$tx&ty=$ty&tz=$tz&$extra" >/dev/null 2>&1
playwright-cli -s=aqua console 2>&1 | sed -n '2,4p'
playwright-cli -s=aqua screenshot --filename=shots/$name.png >/dev/null 2>&1
