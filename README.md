# Softwarized and Virtualized Mobile Networks 2 - On Demand SDN Slices

This repository contains the project for the Softwarized and Virtualized Mobile Networks course project "On Demand SDN Slices".

## Install

Before installing this project install the required packages:

```
sudo apt install arping
```

To run this project clone the repository:

```
git clone https://github.com/nicolacarlin/networking-on-demand-slicing-project.git
```

Enter the directory:

```
cd networking-on-demand-slicing-project
```

Open up two terminals and run:

```
sudo ovs-vsctl set-manager ptcp:6632
ryu run --observe-links gui_topology.py
```
on the first terminal and:

```
sudo python3 topology.py
```
on the second one.

The project should be correctly running.

## Topology viewer

Once you set up and run the project open up your browser at _https://localhost:8080/index.html_

Here you can see the representation of the topology and modify the slices as you want.
