
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
        for i in range(0, len(switches)-1):
              self.addLink(switches[i], switches[i+1], **switch_link_config)       

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
    net.start()

    CLI(net)
    net.stop()
