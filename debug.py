#!/usr/bin/env python3

import sys

from ryu.cmd import manager


def main():
    #sys.argv.append('--ofp-tcp-listen-port')
    #sys.argv.append('6632')
    sys.argv.append('--observe-links')
    #sys.argv.append('--verbose')
    sys.argv.append('--wsapi-port')
    sys.argv.append('8080')
    sys.argv.append('--enable-debugger')
    sys.argv.append('gui_topology')
    manager.main()

if __name__ == '__main__':
    main()