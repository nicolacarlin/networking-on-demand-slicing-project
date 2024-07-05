
#!/usr/bin/python3

from mininet.topo import Topo
from mininet.net import Mininet
from mininet.node import RemoteController, OVSSwitch
from mininet.cli import CLI

import time


class NetworkPhysicalTopo(Topo):
    def __init__(self):
        # Initialize topology
        Topo.__init__(self)

        # Create template host, switch, and link
        host_config = dict(inNamespace=True)
        switch_link_config = dict(bw=10)
        host_link_config = dict(bw=1)
        
        switches = []
        hosts = []

        # Create switch nodes
        for i in range(1,7):
            dpid = "%016x" % (i)
            opts = dict(protocols='OpenFlow13')
            switches.append(self.addSwitch("s%d" % (i), dpid=dpid, opts=opts))
            
        # Create host nodes
        for i in range(1,7):
            hosts.append(self.addHost("h%d" % (i), **host_config))

        # Add switch links
        for i in range(0, len(switches)):
            for j in range(i+1, len(switches)):
              self.addLink(switches[i], switches[j], **switch_link_config)       

        # Add host links
        for i in range(0, len(hosts)):
            self.addLink(hosts[i], switches[i], **host_link_config)
       

if __name__ == "__main__":
    topo = NetworkPhysicalTopo()
    net = Mininet(
        topo=topo,
        switch=OVSSwitch,
        build=False,
        autoSetMacs=True,
        autoStaticArp=True
    )
    controller = RemoteController("c1", ip="127.0.0.1", port=6633, protocols="OpenFlow13")
    net.addController(controller)
    net.build()

    controller.cmd("ovs-vsctl set-manager ptcp:6632")

    #Disable IPv6
    for h in net.hosts:
        h.cmd("sysctl -w net.ipv6.conf.all.disable_ipv6=1")
        h.cmd("sysctl -w net.ipv6.conf.default.disable_ipv6=1")
        h.cmd("sysctl -w net.ipv6.conf.lo.disable_ipv6=1")

    for s in net.switches:
        s.cmd("sysctl -w net.ipv6.conf.all.disable_ipv6=1")
        s.cmd("sysctl -w net.ipv6.conf.default.disable_ipv6=1")
        s.cmd("sysctl -w net.ipv6.conf.lo.disable_ipv6=1")

    net.start()

    # Generate gratuitous ARP until STP setup is complete
    for h in net.hosts:
        h.cmd(f"arping -U -I {h.name}-eth0 $(hostname -I) > /dev/null 2>&1 &")
        h.cmd(f"tcpdump -c 1 'arp' and not host $(hostname -I) > /dev/null 2>&1 && sleep 1 && pkill --nslist net --ns $$ arping > /dev/null 2>&1 &")
        time.sleep(0.1)

    CLI(net)
    net.stop()
