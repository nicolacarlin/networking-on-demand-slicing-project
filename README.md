# Softwarized and Virtualized Mobile Networks - On Demand SDN Slices

This repository contains the project for the Softwarized and Virtualized Mobile Networks course project "On Demand SDN Slices".

## Install

> [!NOTE]  
> This project is build upon https://github.com/stevelorenz/comnetsemu.
> To have directly all the dependecy satisfied init the VM using the provided Vagranfile, otherwise install arping and expose the post 8080, to have local access to the dashboard from the host.


Before run this project install the required packages:

```
sudo apt install arping
```

To download this project clone the repository:

```
git clone https://github.com/nicolacarlin/networking-on-demand-slicing-project.git
```

Enter the directory:

```
cd networking-on-demand-slicing-project
```

Open up two terminals and run:

```
ryu run --observe-links gui_topology.py
```
on the first terminal.
And:

```
sudo python3 topology.py
```
on the second one.

The project should be correctly running.

To test the communication between hosts (on the mininet terminal):
```
pingall
```

To test QoS rules application (on the mininet terminal):
```
xterm hX
xterm hY
```

On the terminal for hX:
```
iperf -s -i 1 -p 500X
```

On the terminal for hY:
```
iperf -c 10.0.0.X -p 500X -b <BW>  #(100K -> 100Kb/sec, 1M -> 1Mb/sec, ...)
```

Switch commands if you wish to test the connectivity from Y to X instead.

## Topology viewer

Once you set up and run the project open up your browser at _https://localhost:8080_

Here you can see the representation of the topology and modify the slices as you want.
