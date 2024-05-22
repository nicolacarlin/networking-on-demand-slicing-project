
#!/usr/bin/python3

from mininet.topo import Topo
from mininet.net import Mininet
from mininet.node import OVSKernelSwitch, RemoteController
from mininet.cli import CLI
from mininet.link import TCLink


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
            sconfig = {"dpid": "%016x" % (i)}
            switches.append(self.addSwitch("s%d" % (i), **sconfig))
            
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
       


topos = {"networkphysicaltopo": (lambda: NetworkPhysicalTopo())}

if __name__ == "__main__":
    topo = NetworkPhysicalTopo()
    net = Mininet(
        topo=topo,
        switch=OVSKernelSwitch,
        build=False,
        autoSetMacs=True,
        autoStaticArp=True,
        link=TCLink,
    )
    controller = RemoteController("c1", ip="127.0.0.1", port=6633)
    net.addController(controller)
    net.build()

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

    CLI(net)
    net.stop()
